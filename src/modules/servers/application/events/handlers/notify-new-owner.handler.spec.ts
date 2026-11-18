import { NotifierPort } from '@/modules/notifications'
import { ServerChangedEvent } from '../server-changed.event'
import { NotifyNewOwnerHandler } from './notify-new-owner.handler'

describe('NotifyNewOwnerHandler (REQ-SRV-05)', () => {
    const handedOver = new ServerChangedEvent('ot', [{ topic: 'server', action: 'updated' }], true, [], {
        fromUserId: 'an',
        toUserId: 'binh',
        serverName: 'Ôn thi Giải tích 2'
    })

    it('gives the new owner an item naming the old one and the server as it is called now', async () => {
        const notifier = { ownerTransferred: jest.fn().mockResolvedValue(undefined) }
        await new NotifyNewOwnerHandler(notifier as unknown as NotifierPort).handle(handedOver)
        expect(notifier.ownerTransferred).toHaveBeenCalledWith(
            { serverId: 'ot', serverName: 'Ôn thi Giải tích 2' },
            'an',
            'binh'
        )
    })

    it('says nothing of any other change to the server', async () => {
        const notifier = { ownerTransferred: jest.fn() }
        await new NotifyNewOwnerHandler(notifier as unknown as NotifierPort).handle(
            new ServerChangedEvent('ot', [{ topic: 'server', action: 'updated' }], false)
        )
        expect(notifier.ownerTransferred).not.toHaveBeenCalled()
    })

    it('logs a failure instead of failing: the server is handed over', async () => {
        const notifier = { ownerTransferred: jest.fn().mockRejectedValue(new Error('connection lost')) }
        await expect(
            new NotifyNewOwnerHandler(notifier as unknown as NotifierPort).handle(handedOver)
        ).resolves.toBeUndefined()
    })
})
