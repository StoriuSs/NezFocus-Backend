import { EventBus } from '@nestjs/cqrs'
import { SweepDeletedAccountsCommand } from './sweep-deleted-accounts.command'
import { SweepDeletedAccountsHandler } from './sweep-deleted-accounts.handler'
import { UserRepositoryPort } from '@/modules/users/domain'
import { BackgroundJobsPort } from '../../ports'
import { AccountDeletedEvent } from '../../events/account-deleted.event'

const DAY_MS = 24 * 60 * 60 * 1000

describe('SweepDeletedAccountsHandler', () => {
    const setUp = (repo: Partial<Record<keyof UserRepositoryPort, jest.Mock>>) => {
        const userRepo = {
            deleteDue: jest.fn().mockResolvedValue([]),
            findAvatarsOfDeleted: jest.fn().mockResolvedValue([]),
            forgetAvatarsOfDeleted: jest.fn().mockResolvedValue(undefined),
            ...repo
        }
        const jobs = { deleteFileLater: jest.fn(), deleteFilesLater: jest.fn().mockResolvedValue(undefined) }
        const eventBus = { publish: jest.fn() }
        const handler = new SweepDeletedAccountsHandler(
            userRepo as unknown as UserRepositoryPort,
            jobs as unknown as BackgroundJobsPort,
            eventBus as unknown as EventBus
        )
        return { handler, userRepo, jobs, eventBus }
    }

    it('deletes the accounts whose 14 days are over, and announces each', async () => {
        const now = new Date('2026-10-29T14:47:00Z')
        const { handler, userRepo, eventBus } = setUp({
            deleteDue: jest.fn().mockResolvedValue([
                { id: 'asked', ownerAsked: true },
                { id: 'abandoned', ownerAsked: false }
            ])
        })

        const result = await handler.execute(new SweepDeletedAccountsCommand(now))

        const fourteenDaysAgo = new Date(now.getTime() - 14 * DAY_MS)
        expect(userRepo.deleteDue).toHaveBeenCalledWith(
            { requestedBy: fourteenDaysAgo, incompleteSince: fourteenDaysAgo },
            now
        )
        expect(eventBus.publish.mock.calls).toEqual([
            [new AccountDeletedEvent('asked', true)],
            [new AccountDeletedEvent('abandoned', false)]
        ])
        expect(result.accountsDeleted).toBe(2)
    })

    it('queues the avatar files of deleted accounts before it forgets their keys, so a crash between loses none', async () => {
        const order: string[] = []
        const { handler, userRepo, jobs } = setUp({
            findAvatarsOfDeleted: jest.fn().mockResolvedValue([
                { id: 'just-deleted', avatarKey: 'avatars/a.webp' },
                { id: 'left-by-a-crash', avatarKey: 'avatars/b.webp' }
            ]),
            forgetAvatarsOfDeleted: jest.fn().mockImplementation(async () => {
                order.push('forget')
            })
        })
        jobs.deleteFilesLater.mockImplementation(async () => {
            order.push('queue')
        })

        const result = await handler.execute(new SweepDeletedAccountsCommand(new Date()))

        expect(jobs.deleteFilesLater).toHaveBeenCalledWith(['avatars/a.webp', 'avatars/b.webp'])
        expect(userRepo.forgetAvatarsOfDeleted).toHaveBeenCalledWith(['just-deleted', 'left-by-a-crash'])
        expect(order).toEqual(['queue', 'forget'])
        expect(result.avatarFilesQueued).toBe(2)
    })

    it('keeps the keys when the files cannot be queued, for the next sweep to try again', async () => {
        const { handler, userRepo, jobs } = setUp({
            findAvatarsOfDeleted: jest.fn().mockResolvedValue([{ id: 'u', avatarKey: 'avatars/a.webp' }])
        })
        jobs.deleteFilesLater.mockRejectedValue(new Error('Redis is down'))

        await expect(handler.execute(new SweepDeletedAccountsCommand(new Date()))).rejects.toThrow('Redis is down')
        expect(userRepo.forgetAvatarsOfDeleted).not.toHaveBeenCalled()
    })

    it('touches nothing more when no deleted account holds an avatar', async () => {
        const { handler, userRepo, jobs } = setUp({})

        const result = await handler.execute(new SweepDeletedAccountsCommand(new Date()))

        expect(jobs.deleteFilesLater).not.toHaveBeenCalled()
        expect(userRepo.forgetAvatarsOfDeleted).not.toHaveBeenCalled()
        expect(result.avatarFilesQueued).toBe(0)
    })
})
