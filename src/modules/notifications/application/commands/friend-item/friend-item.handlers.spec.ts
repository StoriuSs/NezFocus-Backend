import { NotificationsCreatedEvent } from '../../events/notifications-created.event'
import { NotificationsDeletedEvent } from '../../events/notifications-deleted.event'
import { notificationWorld } from '../../notification-test-world.shared-spec'
import { ListNotificationsQuery } from '../../queries/inbox/inbox.queries'
import { ListNotificationsHandler } from '../../queries/inbox/inbox.handlers'
import { AddFriendItemCommand, RemoveFriendRequestItemsCommand } from './friend-item.commands'
import { AddFriendItemHandler, RemoveFriendRequestItemsHandler } from './friend-item.handlers'

describe('AddFriendItemHandler (REQ-SOCIAL-01, D-111, D-242)', () => {
    it('gives a request item with its note, belonging to no server, and tells its owner', async () => {
        const world = notificationWorld()

        await new AddFriendItemHandler(...world.deps).execute(
            new AddFriendItemCommand('friend_request', 'binh', 'lan', 'Mình là Lan')
        )

        expect(world.rows.map((row) => [row.userId, row.type, row.serverId, row.actorId, row.note])).toEqual([
            ['binh', 'friend_request', null, 'lan', 'Mình là Lan']
        ])
        const [created] = world.published(NotificationsCreatedEvent) as NotificationsCreatedEvent[]
        expect(created!.items[0]!.notification).toMatchObject({
            type: 'friend_request',
            note: 'Mình là Lan',
            actor: { id: 'lan' }
        })
    })

    it('shows friend items in the inbox, though they belong to no server (D-242)', async () => {
        const world = notificationWorld()
        const handler = new AddFriendItemHandler(...world.deps)
        await handler.execute(new AddFriendItemCommand('friend_request', 'binh', 'lan', null))
        await handler.execute(new AddFriendItemCommand('friend_accepted', 'binh', 'chi', null))

        const list = await new ListNotificationsHandler(...world.deps).execute(
            new ListNotificationsQuery('binh', null, 50)
        )

        expect(list.items.map((item) => [item.type, item.note])).toEqual([
            ['friend_accepted', null],
            ['friend_request', null]
        ])
        expect(list.unreadCount).toBe(2)
    })

    it('gives none to someone who blocked the one asking (D-185, D-242)', async () => {
        const world = notificationWorld()
        world.block('binh', 'lan')

        await new AddFriendItemHandler(...world.deps).execute(
            new AddFriendItemCommand('friend_request', 'binh', 'lan', null)
        )

        expect(world.rows).toEqual([])
        expect(world.published(NotificationsCreatedEvent)).toEqual([])
    })
})

describe('RemoveFriendRequestItemsHandler (REQ-NOTIF-03)', () => {
    it('takes the request item off whichever way it went, and tells its owner the new count', async () => {
        const world = notificationWorld()
        const add = new AddFriendItemHandler(...world.deps)
        await add.execute(new AddFriendItemCommand('friend_request', 'binh', 'lan', null))
        await add.execute(new AddFriendItemCommand('friend_accepted', 'binh', 'lan', null))

        await new RemoveFriendRequestItemsHandler(...world.deps).execute(
            new RemoveFriendRequestItemsCommand('lan', 'binh')
        )

        expect(world.rows.map((row) => row.type)).toEqual(['friend_accepted'])
        const [deleted] = world.published(NotificationsDeletedEvent) as NotificationsDeletedEvent[]
        expect(deleted!.entries).toEqual([{ userId: 'binh', ids: ['n001'], unreadCount: 1 }])
    })
})
