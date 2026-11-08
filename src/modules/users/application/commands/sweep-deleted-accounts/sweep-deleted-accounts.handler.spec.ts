import { EventBus } from '@nestjs/cqrs'
import { SweepDeletedAccountsCommand } from './sweep-deleted-accounts.command'
import { SweepDeletedAccountsHandler } from './sweep-deleted-accounts.handler'
import { UserRepositoryPort } from '@/modules/users/domain'
import { AccountDeletedEvent } from '../../events/account-deleted.event'

const DAY_MS = 24 * 60 * 60 * 1000

describe('SweepDeletedAccountsHandler', () => {
    it('deletes the accounts whose 14 days are over, and announces each with the avatar it leaves', async () => {
        const now = new Date('2026-10-29T14:47:00Z')
        const userRepo = {
            deleteDue: jest.fn().mockResolvedValue([
                { id: 'asked', avatarKey: 'avatars/asked.webp' },
                { id: 'abandoned', avatarKey: null }
            ])
        }
        const eventBus = { publish: jest.fn() }
        const handler = new SweepDeletedAccountsHandler(
            userRepo as unknown as UserRepositoryPort,
            eventBus as unknown as EventBus
        )

        const result = await handler.execute(new SweepDeletedAccountsCommand(now))

        const fourteenDaysAgo = new Date(now.getTime() - 14 * DAY_MS)
        expect(userRepo.deleteDue).toHaveBeenCalledWith(
            { requestedBy: fourteenDaysAgo, incompleteSince: fourteenDaysAgo },
            now
        )
        expect(eventBus.publish.mock.calls).toEqual([
            [new AccountDeletedEvent('asked', 'avatars/asked.webp')],
            [new AccountDeletedEvent('abandoned', null)]
        ])
        expect(result.accountsDeleted).toBe(2)
    })
})
