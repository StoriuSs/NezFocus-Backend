import { SweepDeletedAccountsCommand } from './sweep-deleted-accounts.command'
import { SweepDeletedAccountsHandler } from './sweep-deleted-accounts.handler'
import { UserRepositoryPort } from '@/modules/users/domain'

describe('SweepDeletedAccountsHandler', () => {
    it('deletes sign-ups never confirmed only once older than their retention period', async () => {
        const userRepo = {
            erasePersonalDataDeletedBefore: jest.fn().mockResolvedValue(0),
            deleteUnverifiedCreatedBefore: jest.fn().mockResolvedValue(2)
        }
        const handler = new SweepDeletedAccountsHandler(userRepo as unknown as UserRepositoryPort)

        const result = await handler.execute(new SweepDeletedAccountsCommand(new Date('2026-09-14T12:00:00Z'), 30, 7))

        expect(userRepo.deleteUnverifiedCreatedBefore).toHaveBeenCalledWith(new Date('2026-09-07T12:00:00Z'))
        expect(result.unverifiedDeleted).toBe(2)
    })
})
