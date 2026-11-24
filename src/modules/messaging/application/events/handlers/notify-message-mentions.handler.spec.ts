import { Logger } from '@nestjs/common'
import { AccessServer, EVERYONE_DEFAULT_PERMISSIONS, Permission, PermissionCheckerPort } from '@/modules/permissions'
import { ChannelDirectoryPort, MembershipPort } from '@/modules/servers'
import { NotifierPort } from '@/modules/notifications'
import { MessageRepositoryPort, ReadStateRepositoryPort } from '../../../domain'
import { MessageView } from '../../services/message-views'
import { MessageCreatedEvent } from '../message-created.event'
import { MessageUpdatedEvent } from '../message-updated.event'
import { NotifyMessageMentionsHandler } from './notify-message-mentions.handler'

const server: AccessServer = {
    ownerId: 'an',
    roles: [
        { id: 'everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true },
        { id: 'truong-nhom', permissions: 0n, position: 1, isEveryone: false },
        { id: 'quan-ly', permissions: Permission.MANAGE_MESSAGES, position: 2, isEveryone: false }
    ],
    channels: [
        {
            id: 'hoi-dap',
            type: 'text',
            isPrivate: false,
            viewRoleIds: [],
            sendMode: 'everyone',
            taskBoardEnabled: false
        },
        {
            id: 'bi-mat',
            type: 'text',
            isPrivate: true,
            viewRoleIds: ['quan-ly'],
            sendMode: 'everyone',
            taskBoardEnabled: false
        }
    ]
}

const an = { id: 'an', username: 'an', displayName: 'An', avatarUrl: null }
const SENT = new Date('2026-11-17T08:00:00.000Z')
const named = (...ids: string[]) => ids.map((id) => ({ id, username: id, displayName: id }))

const message = (more: Partial<MessageView> = {}) =>
    ({
        id: 'm5',
        channelId: 'hoi-dap',
        author: an,
        mentionUsers: [],
        mentionRoles: [],
        mentionEveryone: false,
        mentionHereUserIds: [],
        createdAt: SENT,
        ...more
    }) as unknown as MessageView

function world({ mentioned = [] as string[], readers = [] as string[][], joined = {} as Record<string, Date> } = {}) {
    const reads = [...readers]
    const messages = { mentionedIn: jest.fn(async () => mentioned) } as unknown as MessageRepositoryPort
    const readStates = {
        readersPast: jest.fn(async () => reads.shift() ?? [])
    } as unknown as ReadStateRepositoryPort & { readersPast: jest.Mock }
    const channels = {
        serverIdOf: jest.fn(async (id: string) => (id === 'gone' || id.startsWith('dm-') ? null : 'ot'))
    } as unknown as ChannelDirectoryPort
    const membership = {
        channelMembers: jest.fn(async (_serverId: string, filter: { roleIds?: string[]; userIds?: string[] }) => {
            if (filter.userIds) return filter.userIds.map((userId) => ({ userId, joinedAt: joined[userId] ?? SENT }))
            if (filter.roleIds?.includes('truong-nhom')) return [{ userId: 'chi', joinedAt: SENT }]
            return ['an', 'binh', 'chi', 'dung'].map((userId) => ({ userId, joinedAt: SENT }))
        })
    } as unknown as MembershipPort & { channelMembers: jest.Mock }
    const checker = {
        access: jest.fn(async (_serverId: string, userId: string) => ({
            server,
            member: { userId, roleIds: [], timeoutUntil: null }
        }))
    } as unknown as PermissionCheckerPort
    const notifier = {
        messageMentions: jest.fn(async () => undefined),
        messagesDeleted: jest.fn(),
        channelRead: jest.fn(async () => undefined)
    } as unknown as NotifierPort & { messageMentions: jest.Mock; channelRead: jest.Mock }
    const handler = new NotifyMessageMentionsHandler(messages, readStates, channels, membership, checker, notifier)
    return { handler, notifier, membership, readStates }
}

describe('NotifyMessageMentionsHandler (REQ-NOTIF-01, D-183)', () => {
    it('names whom a message is about: by name and the answered author from its mention rows, @here, @everyone and each role among viewers', async () => {
        const { handler, notifier, membership } = world({ mentioned: ['binh', 'dung'] })
        await handler.handle(
            new MessageCreatedEvent(
                message({
                    mentionUsers: [
                        { id: 'binh', username: 'binh', displayName: 'Bình' },
                        { id: 'lan', username: 'lan', displayName: 'Lan' }
                    ],
                    mentionRoles: [{ id: 'truong-nhom', name: 'Trưởng nhóm' }],
                    mentionEveryone: true,
                    mentionHereUserIds: ['chi']
                }),
                'n1'
            )
        )
        expect(notifier.messageMentions).toHaveBeenCalledWith({
            serverId: 'ot',
            channelId: 'hoi-dap',
            messageId: 'm5',
            actorId: 'an',
            sentAt: SENT,
            sources: {
                users: ['binh'],
                repliedTo: 'dung',
                roles: [{ roleId: 'truong-nhom', userIds: ['chi'] }],
                everyone: ['an', 'binh', 'chi', 'dung'],
                here: ['chi']
            },
            readerIds: []
        })
        // Every member views #hoi-dap: no role condition.
        expect(membership.channelMembers).toHaveBeenCalledWith('ot', { viewers: null, roleIds: undefined })
    })

    it('asks only the viewers of a private channel for @everyone', async () => {
        const { handler, membership } = world()
        await handler.handle(new MessageCreatedEvent(message({ channelId: 'bi-mat', mentionEveryone: true }), 'n1'))
        expect(membership.channelMembers).toHaveBeenCalledWith('ot', {
            viewers: { anyOf: [], allOf: [['quan-ly']] },
            roleIds: undefined
        })
    })

    it('makes those who had read past it readers, and marks read for one whose ack came while the items were written (D-199)', async () => {
        const { handler, notifier } = world({ mentioned: ['binh', 'chi'], readers: [['binh'], ['binh', 'chi']] })
        await handler.handle(new MessageCreatedEvent(message({ mentionUsers: named('binh', 'chi') }), 'n1'))
        expect(notifier.messageMentions).toHaveBeenCalledWith(expect.objectContaining({ readerIds: ['binh'] }))
        expect(notifier.channelRead.mock.calls).toEqual([['chi', 'hoi-dap', 'm5']])
    })

    it('on an edit, counts as read past it someone who joined after it was sent (D-170)', async () => {
        const { handler, notifier } = world({
            mentioned: ['binh', 'chi'],
            joined: { chi: new Date('2026-11-17T09:00:00.000Z') }
        })
        await handler.handle(new MessageUpdatedEvent(message({ mentionUsers: named('binh', 'chi') })))
        expect(notifier.messageMentions).toHaveBeenCalledWith(expect.objectContaining({ readerIds: ['chi'] }))
    })

    it('on an edit that mentions no one now, still asks NOTIFIER, which takes the items off', async () => {
        const { handler, notifier, membership } = world()
        await handler.handle(new MessageUpdatedEvent(message()))
        expect(notifier.messageMentions).toHaveBeenCalledWith(expect.objectContaining({ readerIds: [] }))
        expect(membership.channelMembers).not.toHaveBeenCalled()
    })

    it('writes nothing for a new message about no one, a system message or a channel gone', async () => {
        for (const event of [
            new MessageCreatedEvent(message(), 'n1'),
            new MessageCreatedEvent(message({ author: null }), null),
            new MessageCreatedEvent(message({ channelId: 'gone' }), 'n1')
        ]) {
            const { handler, notifier } = world()
            await handler.handle(event)
            expect(notifier.messageMentions).not.toHaveBeenCalled()
        }
    })

    it('puts nothing in an inbox for a message in a DM, even one mentioning the other one (D-238)', async () => {
        const { handler, notifier, readStates } = world({ mentioned: ['binh'] })
        const dm = message({
            channelId: 'dm-an-binh',
            mentionUsers: [{ id: 'binh', username: 'binh', displayName: 'Bình' }]
        })

        await handler.handle(new MessageCreatedEvent(dm, 'n1'))
        await handler.handle(new MessageUpdatedEvent(dm))

        expect(notifier.messageMentions).not.toHaveBeenCalled()
        expect(readStates.readersPast).not.toHaveBeenCalled()
    })

    it('keeps a failure to itself, logged: the message is sent either way', async () => {
        const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
        const { handler, notifier } = world({ mentioned: ['binh'] })
        const failure = new Error('database down')
        notifier.messageMentions.mockRejectedValue(failure)
        await expect(handler.handle(new MessageCreatedEvent(message(), 'n1'))).resolves.toBeUndefined()
        expect(logged).toHaveBeenCalledWith(expect.any(String), failure)
        logged.mockRestore()
    })
})
