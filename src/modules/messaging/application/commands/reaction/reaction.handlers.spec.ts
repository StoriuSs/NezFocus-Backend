import { EventBus } from '@nestjs/cqrs'
import { AccessServer, EVERYONE_DEFAULT_PERMISSIONS, Permission, PermissionCheckerPort } from '@/modules/permissions'
import { ChannelDirectoryPort } from '@/modules/servers'
import {
    CannotReactError,
    MaxReactionsReachedError,
    MessageNotFoundError,
    MessageRepositoryPort,
    MessageRuleError,
    ReactionFacts,
    ReactionRepositoryPort,
    StoredMessage,
    TimedOutError
} from '../../../domain'
import { ReactionAddedEvent } from '../../events/reaction-added.event'
import { ReactionRemovedEvent } from '../../events/reaction-removed.event'
import { AddReactionCommand, RemoveReactionCommand } from './reaction.commands'
import { AddReactionHandler, RemoveReactionHandler } from './reaction.handlers'

/**
 * One server: Bình a member, Phong timed out for an hour, Khánh an
 * ADMINISTRATOR timed out too, An the owner (every right); #ban-quan-ly private to a role no one here has. `noNewReactions`:
 * @everyone lacks ADD_REACTIONS. Messages: m1 in #hoi-dap, m2 in
 * #ban-quan-ly, m3 a system message.
 */
function world({ noNewReactions = false } = {}) {
    const server: AccessServer = {
        ownerId: 'an',
        roles: [
            {
                id: 'everyone',
                permissions: noNewReactions
                    ? EVERYONE_DEFAULT_PERMISSIONS & ~Permission.ADD_REACTIONS
                    : EVERYONE_DEFAULT_PERMISSIONS,
                position: 0,
                isEveryone: true
            },
            { id: 'admin', permissions: Permission.ADMINISTRATOR, position: 1, isEveryone: false }
        ],
        channels: [
            { id: 'hoi-dap', type: 'text', isPrivate: false, viewRoleIds: [], sendMode: 'everyone' },
            { id: 'ban-quan-ly', type: 'text', isPrivate: true, viewRoleIds: ['quan-ly'], sendMode: 'everyone' }
        ]
    }
    const messages = new Map<string, StoredMessage>()
    const seed = (id: string, channelId = 'hoi-dap', type: 'regular' | 'system' = 'regular') =>
        messages.set(id, {
            id,
            channelId,
            type,
            author: type === 'regular' ? { id: 'chi', username: 'chi', displayName: 'Chi', avatarKey: null } : null,
            content: type === 'regular' ? 'Đề cương ôn tập' : '',
            systemEvent: type === 'regular' ? null : 'member_joined',
            systemData: type === 'regular' ? null : { userId: 'dung' },
            replyTo: null,
            mentionEveryone: false,
            mentionRoleIds: [],
            mentionUsers: [],
            editedAt: null,
            pinned: false,
            systemUser: null,
            createdAt: new Date('2026-10-18T20:06:00Z'),
            deleted: false
        })
    seed('m1')
    seed('m2', 'ban-quan-ly')
    seed('m3', 'hoi-dap', 'system')

    /** messageId → emoji → people, in the order given. */
    const given = new Map<string, Map<string, string[]>>()
    const on = (messageId: string) => given.get(messageId) ?? given.set(messageId, new Map()).get(messageId)!
    const reactions: ReactionRepositoryPort = {
        add: jest.fn(async (messageId, emoji, userId, decide: (facts: ReactionFacts) => 'add' | 'already') => {
            const message = messages.get(messageId)
            const emojis = on(messageId)
            const decision = decide({
                messageId,
                live: !!message && !message.deleted,
                system: message?.type === 'system',
                onMessage: emojis.has(emoji),
                mine: emojis.get(emoji)?.includes(userId) ?? false,
                emojiCount: emojis.size
            })
            if (decision === 'add') emojis.set(emoji, [...(emojis.get(emoji) ?? []), userId])
            return decision
        }),
        remove: jest.fn(async (messageId, emoji, userId) => {
            const people = on(messageId).get(emoji) ?? []
            if (!people.includes(userId)) return false
            const left = people.filter((person) => person !== userId)
            if (left.length) on(messageId).set(emoji, left)
            else on(messageId).delete(emoji)
            return true
        }),
        summaries: jest.fn(),
        reactors: jest.fn()
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
                roleIds: userId === 'khanh' ? ['admin'] : [],
                timeoutUntil: ['phong', 'khanh'].includes(userId) ? new Date(Date.now() + 3600_000) : null
            }
        }))
    }
    const events = { publish: jest.fn() }
    const bus = events as unknown as EventBus
    const adder = new AddReactionHandler(repository, reactions, channels, checker, bus)
    const remover = new RemoveReactionHandler(repository, reactions, channels, checker, bus)
    const add = (userId: string, messageId: string, emoji: string) =>
        adder.execute(new AddReactionCommand(userId, messageId, emoji))
    const remove = (userId: string, messageId: string, emoji: string) =>
        remover.execute(new RemoveReactionCommand(userId, messageId, emoji))
    return { add, remove, given, on, messages, events }
}

describe('AddReactionHandler (REQ-MSG-05, SRS 1.71)', () => {
    it('adds the emoji and tells the channel who gave it', async () => {
        const { add, on, events } = world()

        await add('binh', 'm1', '👍')

        expect(on('m1').get('👍')).toEqual(['binh'])
        expect(events.publish).toHaveBeenCalledWith(new ReactionAddedEvent('hoi-dap', 'm1', '👍', 'binh'))
    })

    it('changes nothing and tells no one when they gave it already', async () => {
        const { add, on, events } = world()
        await add('binh', 'm1', '👍')
        events.publish.mockClear()

        await add('binh', 'm1', '👍')

        expect(on('m1').get('👍')).toEqual(['binh'])
        expect(events.publish).not.toHaveBeenCalled()
    })

    it('without ADD_REACTIONS, lets them click an emoji already there but not add a new one', async () => {
        const { add, on } = world({ noNewReactions: true })
        await add('an', 'm1', '🎉')

        await add('binh', 'm1', '🎉')
        await expect(add('binh', 'm1', '👍')).rejects.toBeInstanceOf(CannotReactError)

        expect(on('m1').get('🎉')).toEqual(['an', 'binh'])
    })

    it('refuses someone timed out, before anything else', async () => {
        const { add, on } = world()
        await add('binh', 'm1', '🎉')

        await expect(add('phong', 'm1', '🎉')).rejects.toBeInstanceOf(TimedOutError)
        await expect(add('phong', 'm1', 'not an emoji')).rejects.toBeInstanceOf(TimedOutError)
        expect(on('m1').get('🎉')).toEqual(['binh'])
    })

    it('lets an ADMINISTRATOR react and take it off through a timeout (appendix B, step 1)', async () => {
        const { add, remove, on } = world()
        await add('khanh', 'm1', '👍')
        expect(on('m1').get('👍')).toEqual(['khanh'])
        await remove('khanh', 'm1', '👍')
        expect(on('m1').has('👍')).toBe(false)
    })

    it('refuses a 21st different emoji', async () => {
        const { add, on } = world()
        const twenty = ['😀', '😁', '😂', '🤣', '😃', '😄', '😅', '😆', '😉', '😊']
        for (const emoji of [...twenty, '👍', '👎', '👏', '🙌', '🙏', '💪', '🔥', '🎉', '❤️', '✅'])
            await add('binh', 'm1', emoji)

        await expect(add('binh', 'm1', '🤔')).rejects.toBeInstanceOf(MaxReactionsReachedError)
        expect(on('m1').size).toBe(20)
    })

    it('refuses what is not one standard emoji', async () => {
        const { add } = world()
        await expect(add('binh', 'm1', ':+1:')).rejects.toBeInstanceOf(MessageRuleError)
        await expect(add('binh', 'm1', '👍👍')).rejects.toBeInstanceOf(MessageRuleError)
    })

    it('refuses a system message', async () => {
        const { add } = world()
        await expect(add('binh', 'm3', '👍')).rejects.toBeInstanceOf(MessageRuleError)
    })

    it('answers not found for a message in a channel they do not see, or a deleted one', async () => {
        const { add, messages } = world()
        await expect(add('binh', 'm2', '👍')).rejects.toBeInstanceOf(MessageNotFoundError)
        messages.get('m1')!.deleted = true
        await expect(add('binh', 'm1', '👍')).rejects.toBeInstanceOf(MessageNotFoundError)
    })

    it('keeps one emoji one reaction, written with or without a variation selector it does not need', async () => {
        const { add, remove, on, events } = world()

        await add('binh', 'm1', '👍\u{FE0F}')
        await add('an', 'm1', '👍')

        expect([...on('m1')]).toEqual([['👍', ['binh', 'an']]])
        expect(events.publish).toHaveBeenCalledWith(new ReactionAddedEvent('hoi-dap', 'm1', '👍', 'binh'))

        await remove('binh', 'm1', '👍\u{FE0F}')
        expect(on('m1').get('👍')).toEqual(['an'])
    })
})

describe('RemoveReactionHandler (REQ-MSG-05, SRS 1.71)', () => {
    it('takes their emoji off and tells the channel; nothing to take off tells no one', async () => {
        const { add, remove, on, events } = world()
        await add('binh', 'm1', '👍')
        events.publish.mockClear()

        await remove('binh', 'm1', '👍')
        await remove('binh', 'm1', '👍')

        expect(on('m1').has('👍')).toBe(false)
        expect(events.publish).toHaveBeenCalledTimes(1)
        expect(events.publish).toHaveBeenCalledWith(new ReactionRemovedEvent('hoi-dap', 'm1', '👍', 'binh'))
    })

    it('refuses someone timed out: they cannot take their own off either', async () => {
        const { add, remove, on } = world()
        on('m1').set('👍', ['phong'])
        await add('binh', 'm1', '👍')

        await expect(remove('phong', 'm1', '👍')).rejects.toBeInstanceOf(TimedOutError)
        expect(on('m1').get('👍')).toEqual(['phong', 'binh'])
    })

    it('answers not found for a message in a channel they do not see', async () => {
        const { remove } = world()
        await expect(remove('binh', 'm2', '👍')).rejects.toBeInstanceOf(MessageNotFoundError)
    })
})
