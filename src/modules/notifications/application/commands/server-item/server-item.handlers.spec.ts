import { PresencePort } from '@/modules/realtime'
import { ServerItemDraft } from '../../../domain'
import { NotificationsCreatedEvent } from '../../events/notifications-created.event'
import { notificationWorld } from '../../notification-test-world.shared-spec'
import { AddServerItemCommand } from './server-item.commands'
import { AddServerItemHandler } from './server-item.handlers'

const UNTIL = new Date('2026-11-18T15:30:00Z')

const moderation = (action: 'kick' | 'ban' | 'timeout', reason: string | null = null): ServerItemDraft => ({
    type: 'moderation',
    serverId: 'ot',
    actorId: null,
    facts: { name: 'Ôn thi Giải tích 2', action, timeoutUntil: action === 'timeout' ? UNTIL : null, reason }
})

const handed: ServerItemDraft = {
    type: 'owner_transferred',
    serverId: 'ot',
    actorId: 'an',
    facts: { name: 'Ôn thi Giải tích 2', action: null, timeoutUntil: null, reason: null }
}

function setUp(online: string[] = []) {
    const world = notificationWorld()
    const presence = { connected: jest.fn(async (userId: string) => online.includes(userId)) }
    const handler = new AddServerItemHandler(...world.deps, presence as unknown as PresencePort)
    return { world, presence, handler }
}

describe('AddServerItemHandler (REQ-SRV-05, REQ-ROLE-04, D-187, D-201)', () => {
    it('gives the one moderated an item that keeps the server name, why and until when, naming no one', async () => {
        const { world, handler } = setUp()
        await handler.execute(new AddServerItemCommand(moderation('timeout', 'Nói tục'), 'binh'))

        expect(world.rows.map((row) => [row.userId, row.type, row.serverId, row.channelId, row.actor])).toEqual([
            ['binh', 'moderation', 'ot', null, null]
        ])
        const [created] = world.published(NotificationsCreatedEvent) as NotificationsCreatedEvent[]
        expect(created!.items).toEqual([
            {
                userId: 'binh',
                notification: expect.objectContaining({
                    type: 'moderation',
                    serverId: 'ot',
                    actor: null,
                    readAt: null,
                    server: { name: 'Ôn thi Giải tích 2', action: 'timeout', timeoutUntil: UNTIL, reason: 'Nói tục' }
                })
            }
        ])
    })

    it('makes a kick or ban read when the person has an open tab (its dialog showed), unread when not', async () => {
        const { world, handler } = setUp(['binh'])
        await handler.execute(new AddServerItemCommand(moderation('kick', 'Spam'), 'binh'))
        await handler.execute(new AddServerItemCommand(moderation('ban'), 'chi'))

        expect(world.rows.map((row) => [row.userId, row.server?.action, row.readAt !== null])).toEqual([
            ['binh', 'kick', true],
            ['chi', 'ban', false]
        ])
    })

    it('leaves a timeout unread even with an open tab: no dialog says it (D-201)', async () => {
        const { world, handler } = setUp(['binh'])
        await handler.execute(new AddServerItemCommand(moderation('timeout'), 'binh'))
        expect(world.rows.map((row) => row.readAt)).toEqual([null])
    })

    it('gives the new owner an unread item from the old one, without asking who is online', async () => {
        const { world, presence, handler } = setUp(['binh'])
        await handler.execute(new AddServerItemCommand(handed, 'binh'))

        expect(world.rows.map((row) => [row.userId, row.type, row.actor?.id, row.server?.name, row.readAt])).toEqual([
            ['binh', 'owner_transferred', 'an', 'Ôn thi Giải tích 2', null]
        ])
        expect(presence.connected).not.toHaveBeenCalled()
    })

    it('writes nothing for the one who acted, and tells no one when the item could not be written', async () => {
        const { world, handler } = setUp()
        await handler.execute(new AddServerItemCommand(handed, 'an'))
        expect(world.rows).toEqual([])

        world.deletedServers.add('ot')
        await handler.execute(new AddServerItemCommand(moderation('kick'), 'binh'))
        expect(world.rows).toEqual([])
        expect(world.eventBus.publish).not.toHaveBeenCalled()
    })
})
