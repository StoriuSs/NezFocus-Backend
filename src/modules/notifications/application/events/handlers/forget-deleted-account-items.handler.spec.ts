import { Logger } from '@nestjs/common'
import { AccountDeletedEvent } from '@/modules/users'
import { notificationWorld } from '../../notification-test-world.shared-spec'
import { ForgetDeletedAccountItemsHandler } from './forget-deleted-account-items.handler'

describe('ForgetDeletedAccountItemsHandler (D-203)', () => {
    it('deletes every item of an account deleted for good, and keeps the items others have about it', async () => {
        const world = notificationWorld()
        world.seed({ userId: 'dung', messageId: 'm1' })
        world.seed({ userId: 'dung', messageId: null, type: 'moderation', actorId: null, channelId: null })
        world.seed({ userId: 'binh', messageId: 'm2', actorId: 'dung' })
        world.deletedAccounts.add('dung')

        await new ForgetDeletedAccountItemsHandler(world.repository).handle(new AccountDeletedEvent('dung', true))

        expect(world.rows.map((row) => [row.userId, row.messageId])).toEqual([['binh', 'm2']])
    })

    it('logs a failure instead of throwing; the daily clean-up finishes it', async () => {
        const world = notificationWorld()
        world.repository.removeAllOfDeleted = jest.fn().mockRejectedValue(new Error('db down'))
        const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)

        await expect(
            new ForgetDeletedAccountItemsHandler(world.repository).handle(new AccountDeletedEvent('dung', true))
        ).resolves.toBeUndefined()
        expect(logged).toHaveBeenCalledWith(expect.stringContaining('dung'), expect.any(Error))
        logged.mockRestore()
    })
})
