import { EventBus } from '@nestjs/cqrs'
import { AccessServer, EVERYONE_DEFAULT_PERMISSIONS, Permission, PermissionCheckerPort } from '@/modules/permissions'
import { ChannelDirectoryPort, RoleDirectoryPort } from '@/modules/servers'
import { UserDirectoryPort } from '@/modules/users'
import {
    CannotPinError,
    MaxPinsReachedError,
    MAX_PINS,
    MessageNotFoundError,
    MessageRecord,
    MessageRepositoryPort,
    MessageRuleError,
    PinFacts,
    PinRepositoryPort,
    StoredMessage,
    TimedOutError
} from '../../../domain'
import { MessageCreatedEvent } from '../../events/message-created.event'
import { PinsUpdatedEvent } from '../../events/pins-updated.event'
import { PinMessageCommand, UnpinMessageCommand } from './pin.commands'
import { PinMessageHandler, UnpinMessageHandler } from './pin.handlers'

const server: AccessServer = {
    ownerId: 'an',
    roles: [
        { id: 'everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true },
        { id: 'quan-ly', permissions: Permission.MANAGE_MESSAGES, position: 1, isEveryone: false },
        { id: 'admin', permissions: Permission.ADMINISTRATOR, position: 2, isEveryone: false }
    ],
    channels: [
        { id: 'hoi-dap', type: 'text', isPrivate: false, viewRoleIds: [], sendMode: 'everyone' },
        { id: 'tai-lieu', type: 'text', isPrivate: false, viewRoleIds: [], sendMode: 'everyone' },
        { id: 'ban-quan-ly', type: 'text', isPrivate: true, viewRoleIds: ['quan-ly'], sendMode: 'everyone' }
    ]
}

const person = (id: string, displayName: string) => ({ id, username: id, displayName, avatarKey: null })

/**
 * One server: Bình a member, Chi a moderator (MANAGE_MESSAGES), Phong a
 * moderator timed out for an hour, Khánh an ADMINISTRATOR timed out too, An
 * the owner. Messages: m1 in #hoi-dap,
 * m2 in #ban-quan-ly (private to moderators), m3 a system message.
 */
function world() {
    const messages = new Map<string, StoredMessage>()
    const seed = (id: string, channelId = 'hoi-dap', type: 'regular' | 'system' = 'regular') =>
        messages.set(id, {
            id,
            channelId,
            type,
            author: type === 'regular' ? person('tuan', 'Tuấn') : null,
            content: type === 'regular' ? 'Đề cương ôn tập giữa kỳ' : '',
            systemEvent: type === 'regular' ? null : 'member_joined',
            systemData: type === 'regular' ? null : { userId: 'dung' },
            replyTo: null,
            mentionEveryone: false,
            mentionRoleIds: [],
            mentionUsers: [],
            editedAt: null,
            pinned: false,
            systemUser: null,
            createdAt: new Date('2026-10-16T20:30:00Z'),
            deleted: false
        })
    seed('m1')
    seed('m2', 'ban-quan-ly')
    seed('m3', 'hoi-dap', 'system')

    const pinned = new Map<string, string[]>()
    const pinsOf = (channelId: string) => pinned.get(channelId) ?? []
    let notices = 0
    const pins: PinRepositoryPort = {
        pin: jest.fn(async (channelId, messageId, userId, decide: (facts: PinFacts) => 'pin' | 'already') => {
            const message = messages.get(messageId)
            const decision = decide({
                messageId,
                live: !!message && !message.deleted,
                system: message?.type === 'system',
                pinned: pinsOf(channelId).includes(messageId),
                pinCount: pinsOf(channelId).length
            })
            if (decision === 'already') return { decision, notice: null }
            pinned.set(channelId, [...pinsOf(channelId), messageId])
            notices += 1
            const notice: MessageRecord = {
                id: `notice${notices}`,
                channelId,
                type: 'system',
                author: null,
                content: '',
                systemEvent: 'message_pinned',
                systemData: { userId, messageId },
                systemUser: person(userId, 'Chi'),
                replyTo: null,
                mentionEveryone: false,
                mentionRoleIds: [],
                mentionUsers: [],
                editedAt: null,
                pinned: false,
                createdAt: new Date('2026-10-18T21:00:00Z')
            }
            return { decision, notice }
        }),
        unpin: jest.fn(async (channelId, messageId) => {
            if (!pinsOf(channelId).includes(messageId)) return false
            pinned.set(
                channelId,
                pinsOf(channelId).filter((id) => id !== messageId)
            )
            return true
        }),
        list: jest.fn()
    }
    const repository = {
        find: jest.fn(async (id: string) => messages.get(id) ?? null)
    } as unknown as MessageRepositoryPort
    const channels: ChannelDirectoryPort = { serverIdOf: jest.fn(async () => 'ot') }
    const checker: PermissionCheckerPort = {
        access: jest.fn(async (_serverId: string, userId: string) => ({
            server,
            member: {
                userId,
                roleIds: ['chi', 'phong'].includes(userId) ? ['quan-ly'] : userId === 'khanh' ? ['admin'] : [],
                timeoutUntil: ['phong', 'khanh'].includes(userId) ? new Date(Date.now() + 3600_000) : null
            }
        }))
    }
    const users = { avatarUrl: jest.fn(async () => null) } as unknown as UserDirectoryPort
    const events = { publish: jest.fn() }
    const bus = events as unknown as EventBus
    const pinner = new PinMessageHandler(
        repository,
        pins,
        channels,
        checker,
        users,
        { rolesOf: jest.fn(async () => []) } as RoleDirectoryPort,
        bus
    )
    const unpinner = new UnpinMessageHandler(repository, pins, channels, checker, bus)
    const pin = (userId: string, channelId: string, messageId: string) =>
        pinner.execute(new PinMessageCommand(userId, channelId, messageId))
    const unpin = (userId: string, channelId: string, messageId: string) =>
        unpinner.execute(new UnpinMessageCommand(userId, channelId, messageId))
    return { pin, unpin, pinned, pinsOf, seed, messages, events }
}

describe('PinMessageHandler (REQ-MSG-07, REQ-MSG-08, SRS 1.71)', () => {
    it('pins the message, tells the channel, and posts "Chi pinned a message" there', async () => {
        const { pin, pinsOf, events } = world()

        await pin('chi', 'hoi-dap', 'm1')

        expect(pinsOf('hoi-dap')).toEqual(['m1'])
        const published = events.publish.mock.calls.map(([event]) => event)
        // The pin first, then its system message: one each.
        expect(published.map((event) => event.constructor)).toEqual([PinsUpdatedEvent, MessageCreatedEvent])
        expect(published[0]).toEqual(new PinsUpdatedEvent('hoi-dap', 'm1', true))
        expect(published[1]).toMatchObject({
            nonce: null,
            message: {
                type: 'system',
                systemEvent: 'message_pinned',
                systemData: { userId: 'chi', messageId: 'm1' },
                systemUser: { id: 'chi', displayName: 'Chi' }
            }
        })
    })

    it('pinning a pinned message changes nothing: no second system message, no event', async () => {
        const { pin, pinsOf, events } = world()
        await pin('chi', 'hoi-dap', 'm1')
        events.publish.mockClear()

        await pin('an', 'hoi-dap', 'm1')

        expect(pinsOf('hoi-dap')).toEqual(['m1'])
        expect(events.publish).not.toHaveBeenCalled()
    })

    it('refuses without MANAGE_MESSAGES', async () => {
        const { pin, pinsOf } = world()
        await expect(pin('binh', 'hoi-dap', 'm1')).rejects.toBeInstanceOf(CannotPinError)
        expect(pinsOf('hoi-dap')).toEqual([])
    })

    it('refuses a moderator timed out with the timeout, not "forbidden"', async () => {
        const { pin } = world()
        await expect(pin('phong', 'hoi-dap', 'm1')).rejects.toBeInstanceOf(TimedOutError)
    })

    it('lets an ADMINISTRATOR pin through a timeout (appendix B, step 1)', async () => {
        const { pin, pinsOf } = world()
        await pin('khanh', 'hoi-dap', 'm1')
        expect(pinsOf('hoi-dap')).toEqual(['m1'])
    })

    it('refuses the 51st pin of a channel', async () => {
        const { pin, pinned, seed } = world()
        pinned.set(
            'hoi-dap',
            Array.from({ length: MAX_PINS }, (_, index) => `old${index}`)
        )
        seed('m4')

        await expect(pin('chi', 'hoi-dap', 'm4')).rejects.toBeInstanceOf(MaxPinsReachedError)
    })

    it('refuses a system message', async () => {
        const { pin } = world()
        await expect(pin('chi', 'hoi-dap', 'm3')).rejects.toBeInstanceOf(MessageRuleError)
    })

    it('answers not found for a message of another channel than the route says, a hidden or a deleted one', async () => {
        const { pin, messages } = world()
        await expect(pin('chi', 'tai-lieu', 'm1')).rejects.toBeInstanceOf(MessageNotFoundError)
        await expect(pin('binh', 'ban-quan-ly', 'm2')).rejects.toBeInstanceOf(MessageNotFoundError)
        messages.get('m1')!.deleted = true
        await expect(pin('chi', 'hoi-dap', 'm1')).rejects.toBeInstanceOf(MessageNotFoundError)
    })
})

describe('UnpinMessageHandler (REQ-MSG-07, SRS 1.71)', () => {
    it('unpins and tells the channel, with no system message; unpinning again tells no one', async () => {
        const { pin, unpin, pinsOf, events } = world()
        await pin('chi', 'hoi-dap', 'm1')
        events.publish.mockClear()

        await unpin('an', 'hoi-dap', 'm1')
        await unpin('an', 'hoi-dap', 'm1')

        expect(pinsOf('hoi-dap')).toEqual([])
        expect(events.publish).toHaveBeenCalledTimes(1)
        expect(events.publish).toHaveBeenCalledWith(new PinsUpdatedEvent('hoi-dap', 'm1', false))
    })

    it('refuses without MANAGE_MESSAGES, and a moderator timed out with the timeout', async () => {
        const { pin, unpin, pinsOf } = world()
        await pin('chi', 'hoi-dap', 'm1')

        await expect(unpin('binh', 'hoi-dap', 'm1')).rejects.toBeInstanceOf(CannotPinError)
        await expect(unpin('phong', 'hoi-dap', 'm1')).rejects.toBeInstanceOf(TimedOutError)
        expect(pinsOf('hoi-dap')).toEqual(['m1'])
    })

    it('answers not found for a message of another channel than the route says', async () => {
        const { unpin } = world()
        await expect(unpin('chi', 'tai-lieu', 'm1')).rejects.toBeInstanceOf(MessageNotFoundError)
    })
})
