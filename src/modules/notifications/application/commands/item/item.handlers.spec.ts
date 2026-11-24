import { MessageMentionSources } from '../../../domain'
import { NotificationsCreatedEvent } from '../../events/notifications-created.event'
import { NotificationsDeletedEvent } from '../../events/notifications-deleted.event'
import { notificationWorld } from '../../notification-test-world.shared-spec'
import { MessageNotice } from '../../ports'
import { RemoveMessageItemsCommand, SyncMessageItemsCommand } from './item.commands'
import { RemoveMessageItemsHandler, SyncMessageItemsHandler } from './item.handlers'

const none: MessageMentionSources = { users: [], repliedTo: null, roles: [], everyone: [], here: [] }

const notice = (sources: Partial<MessageMentionSources>, more: Partial<MessageNotice> = {}): MessageNotice => ({
    serverId: 'ot',
    channelId: 'hoi-dap',
    messageId: 'm1',
    actorId: 'an',
    sentAt: new Date(),
    sources: { ...none, ...sources },
    readerIds: [],
    ...more
})

describe('SyncMessageItemsHandler (REQ-NOTIF-01, D-183, D-188)', () => {
    it('writes one item each, unread, and tells each person with the whole item', async () => {
        const world = notificationWorld()
        world.say('m1', '<@binh> mai mang laptop nhé')
        await new SyncMessageItemsHandler(...world.deps).execute(
            new SyncMessageItemsCommand(notice({ users: ['binh'], everyone: ['an', 'binh', 'chi'] }))
        )

        expect(world.rows.map((row) => [row.userId, row.reason, row.readAt])).toEqual([
            ['binh', 'user', null],
            ['chi', 'everyone', null]
        ])
        const [created] = world.published(NotificationsCreatedEvent) as NotificationsCreatedEvent[]
        expect(created!.items.map((item) => item.userId).sort()).toEqual(['binh', 'chi'])
        expect(created!.items[0]!.notification).toMatchObject({
            messageId: 'm1',
            actor: { id: 'an', avatarUrl: 'https://cdn/an.png' },
            message: { content: '<@binh> mai mang laptop nhé' }
        })
    })

    it('writes read the items of those who had read past the message (D-199)', async () => {
        const world = notificationWorld()
        world.say('m1')
        await new SyncMessageItemsHandler(...world.deps).execute(
            new SyncMessageItemsCommand(notice({ users: ['binh', 'chi'] }, { readerIds: ['chi'] }))
        )
        expect(world.rows.find((row) => row.userId === 'chi')!.readAt).not.toBeNull()
        expect(world.rows.find((row) => row.userId === 'binh')!.readAt).toBeNull()
    })

    it('on an edit, takes off the items of those no longer mentioned and tells them their new count', async () => {
        const world = notificationWorld()
        world.say('m1')
        world.seed({ userId: 'binh', messageId: 'm1' })
        world.seed({ userId: 'chi', messageId: 'm1', readAt: new Date() })
        await new SyncMessageItemsHandler(...world.deps).execute(new SyncMessageItemsCommand(notice({})))

        expect(world.rows).toEqual([])
        const [deleted] = world.published(NotificationsDeletedEvent) as NotificationsDeletedEvent[]
        expect(deleted!.entries).toEqual(
            expect.arrayContaining([
                { userId: 'binh', ids: ['n001'], unreadCount: 0 },
                { userId: 'chi', ids: ['n002'], unreadCount: null }
            ])
        )
    })

    it('on an edit, keeps what is there and its read state, changing why', async () => {
        const world = notificationWorld()
        world.say('m1')
        const read = new Date()
        world.seed({ userId: 'binh', messageId: 'm1', type: 'reply', reason: null, readAt: read })
        await new SyncMessageItemsHandler(...world.deps).execute(
            new SyncMessageItemsCommand(notice({ users: ['binh'], repliedTo: 'binh' }))
        )
        expect(world.rows).toEqual([
            expect.objectContaining({ id: 'n001', type: 'mention', reason: 'user', readAt: read })
        ])
        expect(world.eventBus.publish).not.toHaveBeenCalled()
    })

    it('gives a message older than 90 days no new item on an edit', async () => {
        const world = notificationWorld()
        world.say('m1')
        await new SyncMessageItemsHandler(...world.deps).execute(
            new SyncMessageItemsCommand(notice({ users: ['binh'] }, { sentAt: new Date(Date.now() - 91 * 86_400_000) }))
        )
        expect(world.rows).toEqual([])
        expect(world.repository.applyMessagePlan).not.toHaveBeenCalled()
    })

    it('takes the items back off when the message was deleted while they were written, so no badge counts them', async () => {
        const world = notificationWorld()
        await new SyncMessageItemsHandler(...world.deps).execute(
            new SyncMessageItemsCommand(notice({ users: ['binh'] }))
        )
        expect(world.rows).toEqual([])
        expect(world.published(NotificationsCreatedEvent)).toEqual([])
        const [deleted] = world.published(NotificationsDeletedEvent) as NotificationsDeletedEvent[]
        expect(deleted!.entries).toEqual([{ userId: 'binh', ids: ['n001'], unreadCount: 0 }])
    })

    it('changes the reason of many items in one write per reason', async () => {
        const world = notificationWorld()
        world.say('m1')
        for (const userId of ['binh', 'chi', 'dung']) world.seed({ userId, messageId: 'm1', reason: 'here' })
        await new SyncMessageItemsHandler(...world.deps).execute(
            new SyncMessageItemsCommand(notice({ everyone: ['binh', 'chi', 'dung'] }))
        )
        expect(world.rows.map((row) => row.reason)).toEqual(['everyone', 'everyone', 'everyone'])
        expect(world.eventBus.publish).not.toHaveBeenCalled()
    })
})

describe('RemoveMessageItemsHandler (REQ-NOTIF-03)', () => {
    it('takes off the items of the messages deleted, only in that channel', async () => {
        const world = notificationWorld()
        world.seed({ userId: 'binh', messageId: 'm1' })
        world.seed({ userId: 'chi', messageId: 'm2' })
        world.seed({ userId: 'chi', messageId: 'm1', channelId: 'bi-mat' })
        await new RemoveMessageItemsHandler(...world.deps).execute(
            new RemoveMessageItemsCommand('hoi-dap', ['m1', 'm2'])
        )
        expect(world.rows.map((row) => row.id)).toEqual(['n003'])
        const [deleted] = world.published(NotificationsDeletedEvent) as NotificationsDeletedEvent[]
        expect(deleted!.entries).toEqual(
            expect.arrayContaining([
                { userId: 'binh', ids: ['n001'], unreadCount: 0 },
                { userId: 'chi', ids: ['n002'], unreadCount: 1 }
            ])
        )
    })

    it('says nothing when the messages had no item', async () => {
        const world = notificationWorld()
        await new RemoveMessageItemsHandler(...world.deps).execute(new RemoveMessageItemsCommand('hoi-dap', ['m9']))
        expect(world.eventBus.publish).not.toHaveBeenCalled()
    })
})

describe('SyncMessageItemsHandler and blocks (D-185, D-242)', () => {
    it('makes no mention item for someone who blocked the author', async () => {
        const world = notificationWorld()
        world.say('m1')
        world.block('chi', 'an')

        await new SyncMessageItemsHandler(...world.deps).execute(
            new SyncMessageItemsCommand({
                serverId: 'ot',
                channelId: 'hoi-dap',
                messageId: 'm1',
                actorId: 'an',
                sentAt: new Date(),
                sources: { users: ['binh', 'chi'], repliedTo: null, roles: [], everyone: [], here: [] },
                readerIds: []
            })
        )

        expect(world.rows.map((row) => row.userId)).toEqual(['binh'])
    })

    it('keeps the item of one who blocked the author since, when the message is edited: hidden, back once unblocked', async () => {
        const world = notificationWorld()
        world.say('m1')
        const held = world.seed({ userId: 'chi', messageId: 'm1' })
        world.block('chi', 'an')

        await new SyncMessageItemsHandler(...world.deps).execute(
            new SyncMessageItemsCommand({
                serverId: 'ot',
                channelId: 'hoi-dap',
                messageId: 'm1',
                actorId: 'an',
                sentAt: new Date(),
                sources: { users: ['binh', 'chi'], repliedTo: null, roles: [], everyone: [], here: [] },
                readerIds: []
            })
        )

        expect(world.rows.map((row) => [row.userId, row.id === held.id])).toEqual([
            ['chi', true],
            ['binh', false]
        ])
        expect(world.published(NotificationsDeletedEvent)).toEqual([])
    })
})
