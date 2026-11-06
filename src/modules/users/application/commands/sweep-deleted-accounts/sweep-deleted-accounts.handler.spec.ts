import { SweepDeletedAccountsCommand } from './sweep-deleted-accounts.command'
import { SweepDeletedAccountsHandler } from './sweep-deleted-accounts.handler'
import { UserRepositoryPort } from '@/modules/users/domain'

describe('SweepDeletedAccountsHandler', () => {
    it('erases the personal data of accounts deleted longer ago than the retention period', async () => {
        const userRepo = { erasePersonalDataDeletedBefore: jest.fn().mockResolvedValue(2) }
        const handler = new SweepDeletedAccountsHandler(userRepo as unknown as UserRepositoryPort)

        const result = await handler.execute(new SweepDeletedAccountsCommand(new Date('2026-09-14T12:00:00Z'), 30))

        expect(userRepo.erasePersonalDataDeletedBefore).toHaveBeenCalledWith(new Date('2026-08-15T12:00:00Z'))
        expect(result.accountsErased).toBe(2)
    })
})
