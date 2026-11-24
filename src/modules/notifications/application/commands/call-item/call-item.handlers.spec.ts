import { NotificationsCreatedEvent } from '../../events/notifications-created.event'
import { notificationWorld } from '../../notification-test-world.shared-spec'
import { ListNotificationsQuery } from '../../queries/inbox/inbox.queries'
import { ListNotificationsHandler } from '../../queries/inbox/inbox.handlers'
import { ReadChannelItemsCommand } from '../read/read.commands'
import { ReadChannelItemsHandler } from '../read/read.handlers'
import { AddMissedCallItemCommand } from './call-item.commands'
import { AddMissedCallItemHandler } from './call-item.handlers'

describe('AddMissedCallItemHandler (REQ-SOCIAL-06, D-120, D-242)', () => {
    it('gives the callee a missed call item naming the message in their DM, belonging to no server', async () => {
        const world = notificationWorld()

        await new AddMissedCallItemHandler(...world.deps).execute(
            new AddMissedCallItemCommand('binh', 'lan', 'dm-binh-lan', 'm-call')
        )

        expect(world.rows.map((row) => [row.userId, row.type, row.serverId, row.channelId, row.messageId])).toEqual([
            ['binh', 'missed_call', null, 'dm-binh-lan', 'm-call']
        ])
        const [created] = world.published(NotificationsCreatedEvent) as NotificationsCreatedEvent[]
        expect(created!.items[0]!.notification).toMatchObject({
            type: 'missed_call',
            actor: { id: 'lan' },
            message: null
        })
    })

    it('shows it in the inbox though no server holds its DM, and reads it with the DM past its message', async () => {
        const world = notificationWorld()
        await new AddMissedCallItemHandler(...world.deps).execute(
            new AddMissedCallItemCommand('binh', 'lan', 'dm-binh-lan', 'm-call')
        )
        const list = () =>
            new ListNotificationsHandler(...world.deps).execute(new ListNotificationsQuery('binh', null, 50))

        expect((await list()).items.map((item) => item.type)).toEqual(['missed_call'])
        expect((await list()).unreadCount).toBe(1)

        await new ReadChannelItemsHandler(...world.deps).execute(
            new ReadChannelItemsCommand('binh', 'dm-binh-lan', 'm-call')
        )

        expect((await list()).unreadCount).toBe(0)
    })

    it('gives none to someone who blocked the caller (D-185, D-242)', async () => {
        const world = notificationWorld()
        world.block('binh', 'lan')

        await new AddMissedCallItemHandler(...world.deps).execute(
            new AddMissedCallItemCommand('binh', 'lan', 'dm-binh-lan', 'm-call')
        )

        expect(world.rows).toEqual([])
    })
})
