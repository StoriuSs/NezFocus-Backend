import { Logger } from '@nestjs/common'
import { MemberChangedEvent } from '@/modules/servers'
import { MessagePurgePort } from '../../ports'
import { DeleteBannedMessagesLaterHandler } from './delete-banned-messages-later.handler'

describe('DeleteBannedMessagesLaterHandler (D-181)', () => {
    const window = { from: new Date('2026-11-09T09:00:00Z'), to: new Date('2026-11-16T09:00:00Z') }
    const setUp = () => {
        const purge = { deleteRecentLater: jest.fn().mockResolvedValue(undefined) }
        const handler = new DeleteBannedMessagesLaterHandler(purge as unknown as MessagePurgePort)
        return { purge, handler }
    }

    it('queues the deletion of the messages a ban names', async () => {
        const { purge, handler } = setUp()

        await handler.handle(new MemberChangedEvent('ot', 'khanh', 'left', 'ban', 'Bán đề', window))

        expect(purge.deleteRecentLater).toHaveBeenCalledWith('ot', 'khanh', window)
    })

    it('says which ban when the job cannot be queued, so its messages can be deleted by hand', async () => {
        const { purge, handler } = setUp()
        purge.deleteRecentLater.mockRejectedValueOnce(new Error('Redis down'))
        const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)

        await expect(
            handler.handle(new MemberChangedEvent('ot', 'khanh', 'left', 'ban', null, window))
        ).rejects.toThrow('Redis down')
        expect(String(logged.mock.calls[0][0])).toContain('khanh')
        expect(String(logged.mock.calls[0][0])).toContain('2026-11-09T09:00:00.000Z')
        logged.mockRestore()
    })

    it('queues nothing for a ban that keeps their messages, a kick, or any other change', async () => {
        const { purge, handler } = setUp()

        await handler.handle(new MemberChangedEvent('ot', 'khanh', 'left', 'ban', null))
        await handler.handle(new MemberChangedEvent('ot', 'khanh', 'left', 'kick', null))
        await handler.handle(new MemberChangedEvent('ot', 'khanh', 'left'))
        await handler.handle(new MemberChangedEvent('ot', 'khanh', 'joined'))

        expect(purge.deleteRecentLater).not.toHaveBeenCalled()
    })
})
