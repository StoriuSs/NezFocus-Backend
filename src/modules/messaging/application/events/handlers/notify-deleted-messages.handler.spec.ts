import { Logger } from '@nestjs/common'
import { NotifierPort } from '@/modules/notifications'
import { MessageDeletedEvent } from '../message-deleted.event'
import { MessagesBulkDeletedEvent } from '../messages-bulk-deleted.event'
import { ReadStateUpdatedEvent } from '../read-state-updated.event'
import { NotifyChannelReadHandler } from './notify-channel-read.handler'
import { NotifyDeletedMessagesHandler } from './notify-deleted-messages.handler'

const notifier = () =>
    ({
        messagesDeleted: jest.fn(async () => undefined),
        channelRead: jest.fn(async () => undefined)
    }) as unknown as NotifierPort & {
        messagesDeleted: jest.Mock
        channelRead: jest.Mock
    }

describe('NotifyDeletedMessagesHandler (REQ-NOTIF-03)', () => {
    it('takes off the items of a message deleted by hand, and of those a ban deletes', async () => {
        const to = notifier()
        const handler = new NotifyDeletedMessagesHandler(to)
        await handler.handle(new MessageDeletedEvent('m1', 'hoi-dap'))
        await handler.handle(new MessagesBulkDeletedEvent('hoi-dap', ['m2', 'm3']))
        expect(to.messagesDeleted.mock.calls).toEqual([
            ['hoi-dap', ['m1']],
            ['hoi-dap', ['m2', 'm3']]
        ])
    })

    it('keeps a failure to itself, logged', async () => {
        const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
        const to = notifier()
        to.messagesDeleted.mockRejectedValue(new Error('down'))
        await expect(
            new NotifyDeletedMessagesHandler(to).handle(new MessageDeletedEvent('m1', 'hoi-dap'))
        ).resolves.toBeUndefined()
        expect(logged).toHaveBeenCalled()
        logged.mockRestore()
    })
})

describe('NotifyChannelReadHandler (D-188)', () => {
    const state = { serverId: 'ot', channelId: 'hoi-dap', lastReadId: 'm9', unreadCount: 0, mentionCount: 0 }

    it('marks read the items of the channel up to where it was read', async () => {
        const to = notifier()
        await new NotifyChannelReadHandler(to).handle(new ReadStateUpdatedEvent('binh', state))
        expect(to.channelRead).toHaveBeenCalledWith('binh', 'hoi-dap', 'm9')
    })

    it('keeps a failure to itself, logged', async () => {
        const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
        const to = notifier()
        to.channelRead.mockRejectedValue(new Error('down'))
        await expect(
            new NotifyChannelReadHandler(to).handle(new ReadStateUpdatedEvent('binh', state))
        ).resolves.toBeUndefined()
        expect(logged).toHaveBeenCalled()
        logged.mockRestore()
    })
})
