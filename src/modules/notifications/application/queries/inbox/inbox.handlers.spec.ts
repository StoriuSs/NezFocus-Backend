import { notificationWorld } from '../../notification-test-world.shared-spec'
import { ListNotificationsQuery } from './inbox.queries'
import { ListNotificationsHandler } from './inbox.handlers'

describe('ListNotificationsHandler (REQ-NOTIF-01, REQ-NOTIF-03)', () => {
    it('gives the newest first, a page at a time, with the unread count of what one may see', async () => {
        const world = notificationWorld()
        for (const id of ['m1', 'm2', 'm3']) {
            world.say(id)
            world.seed({ userId: 'binh', messageId: id })
        }
        const handler = new ListNotificationsHandler(...world.deps)

        const first = await handler.execute(new ListNotificationsQuery('binh', null, 2))
        expect(first.items.map((item) => item.id)).toEqual(['n003', 'n002'])
        expect(first).toMatchObject({ unreadCount: 3, hasMore: true })
        const next = await handler.execute(new ListNotificationsQuery('binh', 'n002', 2))
        expect(next.items.map((item) => item.id)).toEqual(['n001'])
        expect(next.hasMore).toBe(false)
    })

    it('hides the items of a private channel one no longer views and of a server one left, from the list and the count', async () => {
        const world = notificationWorld()
        world.say('m1')
        world.say('m2')
        world.say('m3')
        world.seed({ userId: 'binh', messageId: 'm1', channelId: 'bi-mat' })
        world.seed({ userId: 'binh', messageId: 'm2', serverId: 'cu', channelId: 'cu-chat' })
        world.seed({ userId: 'binh', messageId: 'm3' })
        world.seed({ userId: 'chi', messageId: 'm1', channelId: 'bi-mat' })
        const handler = new ListNotificationsHandler(...world.deps)

        const binh = await handler.execute(new ListNotificationsQuery('binh', null, 50))
        expect(binh.items.map((item) => item.messageId)).toEqual(['m3'])
        expect(binh.unreadCount).toBe(1)
        const chi = await handler.execute(new ListNotificationsQuery('chi', null, 50))
        expect(chi.items.map((item) => item.messageId)).toEqual(['m1'])

        // Out of "ot": hidden; back in: shown again, unread as it was.
        world.servers['ot'] = ['an', 'chi']
        expect(await handler.execute(new ListNotificationsQuery('binh', null, 50))).toMatchObject({
            items: [],
            unreadCount: 0
        })
        world.servers['ot'] = ['an', 'binh', 'chi']
        const back = await handler.execute(new ListNotificationsQuery('binh', null, 50))
        expect(back.items.map((item) => [item.messageId, item.readAt])).toEqual([['m3', null]])
    })

    it('keeps showing moderation items after one is put out of the server, an owner item only while in it (REQ-NOTIF-03)', async () => {
        const world = notificationWorld()
        const server = (action: 'kick' | null) => ({ name: 'ÔT', action, timeoutUntil: null, reason: null })
        world.seed({
            userId: 'binh',
            messageId: null,
            type: 'owner_transferred',
            channelId: null,
            server: server(null)
        })
        world.seed({
            userId: 'binh',
            messageId: null,
            type: 'moderation',
            channelId: null,
            actor: null,
            server: server('kick')
        })
        world.seed({
            userId: 'binh',
            messageId: null,
            type: 'moderation',
            serverId: 'cu',
            channelId: null,
            actor: null,
            server: server('kick')
        })
        const handler = new ListNotificationsHandler(...world.deps)

        const inServer = await handler.execute(new ListNotificationsQuery('binh', null, 50))
        expect(inServer.items.map((item) => [item.type, item.serverId])).toEqual([
            ['moderation', 'cu'],
            ['moderation', 'ot'],
            ['owner_transferred', 'ot']
        ])
        expect(inServer.unreadCount).toBe(3)
        expect(inServer.items[0]!.server).toEqual(server('kick'))

        world.servers['ot'] = ['an', 'chi']
        const out = await handler.execute(new ListNotificationsQuery('binh', null, 50))
        expect(out.items.map((item) => [item.type, item.serverId])).toEqual([
            ['moderation', 'cu'],
            ['moderation', 'ot']
        ])
        expect(out.unreadCount).toBe(2)
    })

    it('leaves out an item whose message is deleted, and a picture that cannot be signed', async () => {
        const world = notificationWorld()
        world.say('m2')
        world.seed({ userId: 'binh', messageId: 'm1' })
        world.seed({
            userId: 'binh',
            messageId: 'm2',
            actor: { id: 'x', username: null, displayName: null, avatarKey: 'broken.png' }
        })
        world.seed({ userId: 'binh', messageId: 'm2', actor: null })
        const list = await new ListNotificationsHandler(...world.deps).execute(
            new ListNotificationsQuery('binh', null, 50)
        )
        expect(list.items.map((item) => [item.messageId, item.actor ? item.actor.avatarUrl : 'no actor'])).toEqual([
            ['m2', 'no actor'],
            ['m2', null]
        ])
    })

    it('reads no message when the page has none', async () => {
        const world = notificationWorld()
        const list = await new ListNotificationsHandler(...world.deps).execute(
            new ListNotificationsQuery('lan', null, 50)
        )
        expect(list).toEqual({ items: [], unreadCount: 0, hasMore: false })
        expect(world.previews.previewsOf).not.toHaveBeenCalled()
    })
})
