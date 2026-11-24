import { Logger } from '@nestjs/common'
import { NotifierPort } from '@/modules/notifications'
import { AccountDeletedEvent } from '@/modules/users'
import { RelationshipRepositoryPort } from '../../../domain'
import { ForgetDeletedAccountHandler } from './forget-deleted-account.handler'

function setUp(forget: () => Promise<string[]>) {
    const relationships = { forgetAccount: jest.fn(forget) }
    const notifier = { friendRequestClosed: jest.fn() }
    const handler = new ForgetDeletedAccountHandler(
        relationships as unknown as RelationshipRepositoryPort,
        notifier as unknown as NotifierPort
    )
    return { relationships, notifier, handle: () => handler.handle(new AccountDeletedEvent('giang')) }
}

describe('ForgetDeletedAccountHandler (D-243)', () => {
    it('deletes the relationships and blocks of an account deleted for good', async () => {
        const { relationships, handle } = setUp(async () => [])
        await handle()
        expect(relationships.forgetAccount).toHaveBeenCalledWith('giang')
    })

    it('takes off the items of the requests that were waiting, either way (REQ-NOTIF-03)', async () => {
        const { notifier, handle } = setUp(async () => ['an', 'binh'])
        await handle()
        expect(notifier.friendRequestClosed.mock.calls).toEqual([
            ['giang', 'an'],
            ['giang', 'binh']
        ])
    })

    it('logs a failure rather than throw: every read leaves the account out anyway', async () => {
        const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
        const { handle } = setUp(async () => Promise.reject(new Error('Postgres is down')))

        await expect(handle()).resolves.toBeUndefined()

        expect(error).toHaveBeenCalled()
        error.mockRestore()
    })
})
