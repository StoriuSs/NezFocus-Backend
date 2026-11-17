import { NotificationsReadEvent } from '../../events/notifications-read.event'
import { notificationWorld } from '../../notification-test-world.shared-spec'
import { MarkNotificationsReadCommand, ReadChannelItemsCommand } from './read.commands'
import { MarkNotificationsReadHandler, ReadChannelItemsHandler } from './read.handlers'

describe('ReadChannelItemsHandler (D-188)', () => {
    it('marks read the mention and reply items of the channel up to the message, and tells every tab', async () => {
        const world = notificationWorld()
        world.seed({ userId: 'binh', messageId: 'm1' })
        world.seed({ userId: 'binh', messageId: 'm2', type: 'reply', reason: null })
        world.seed({ userId: 'binh', messageId: 'm3' })
        world.seed({ userId: 'binh', messageId: 'm1', channelId: 'khac' })
        await new ReadChannelItemsHandler(...world.deps).execute(new ReadChannelItemsCommand('binh', 'hoi-dap', 'm2'))

        expect(world.rows.map((row) => row.readAt !== null)).toEqual([true, true, false, false])
        expect(world.published(NotificationsReadEvent)).toEqual([
            new NotificationsReadEvent('binh', ['n001', 'n002'], null, 1)
        ])
    })

    it('says nothing when nothing was left to mark', async () => {
        const world = notificationWorld()
        world.seed({ userId: 'binh', messageId: 'm1', readAt: new Date() })
        await new ReadChannelItemsHandler(...world.deps).execute(new ReadChannelItemsCommand('binh', 'hoi-dap', 'm1'))
        expect(world.eventBus.publish).not.toHaveBeenCalled()
    })
})

describe('MarkNotificationsReadHandler (REQ-NOTIF-02)', () => {
    it('marks the items named, the person’s only, and gives the count left', async () => {
        const world = notificationWorld()
        world.seed({ userId: 'binh', messageId: 'm1' })
        world.seed({ userId: 'binh', messageId: 'm2' })
        world.seed({ userId: 'chi', messageId: 'm1' })
        const result = await new MarkNotificationsReadHandler(...world.deps).execute(
            new MarkNotificationsReadCommand('binh', { ids: ['n001', 'n003'] })
        )
        expect(result).toEqual({ unreadCount: 1 })
        expect(world.rows.map((row) => row.readAt !== null)).toEqual([true, false, false])
        // Only what was marked: not Chi's item.
        expect(world.published(NotificationsReadEvent)).toEqual([new NotificationsReadEvent('binh', ['n001'], null, 1)])
    })

    it('marks all up to the newest shown, leaving one that came after it unread', async () => {
        const world = notificationWorld()
        world.seed({ userId: 'binh', messageId: 'm1' })
        world.seed({ userId: 'binh', messageId: 'm2' })
        world.seed({ userId: 'binh', messageId: 'm3' })
        const result = await new MarkNotificationsReadHandler(...world.deps).execute(
            new MarkNotificationsReadCommand('binh', { beforeId: 'n002' })
        )
        expect(result).toEqual({ unreadCount: 1 })
        expect(world.published(NotificationsReadEvent)).toEqual([new NotificationsReadEvent('binh', null, 'n002', 1)])
    })

    it('says nothing to the tabs when nothing changed, still giving the count', async () => {
        const world = notificationWorld()
        world.seed({ userId: 'binh', messageId: 'm1' })
        const result = await new MarkNotificationsReadHandler(...world.deps).execute(
            new MarkNotificationsReadCommand('binh', { ids: ['n009'] })
        )
        expect(result).toEqual({ unreadCount: 1 })
        expect(world.eventBus.publish).not.toHaveBeenCalled()
    })
})
