import { EventBus } from '@nestjs/cqrs'
import { AccessServer, EVERYONE_DEFAULT_PERMISSIONS, PermissionCheckerPort } from '@/modules/permissions'
import { ChannelDirectoryPort, MembershipPort } from '@/modules/servers'
import {
    ChannelNotFoundError,
    MessageNotFoundError,
    MessageRepositoryPort,
    ReadScope,
    ReadStateRepositoryPort,
    readFloor,
    StoredMessage
} from '../../../domain'
import { ReadStateUpdatedEvent } from '../../events/read-state-updated.event'
import { AckChannelCommand } from './read-state.commands'
import { AckChannelHandler } from './read-state.handlers'

const server: AccessServer = {
    ownerId: 'an',
    roles: [
        { id: 'everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true },
        { id: 'quan-ly', permissions: 0n, position: 1, isEveryone: false }
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
        { id: 'trong', type: 'text', isPrivate: false, viewRoleIds: [], sendMode: 'everyone', taskBoardEnabled: false },
        {
            id: 'ban-quan-ly',
            type: 'text',
            isPrivate: true,
            viewRoleIds: ['quan-ly'],
            sendMode: 'everyone',
            taskBoardEnabled: false
        },
        {
            id: 'phong-hoc',
            type: 'voice',
            isPrivate: false,
            viewRoleIds: [],
            sendMode: 'everyone',
            taskBoardEnabled: false
        }
    ]
}

const JOINED = new Date('2026-11-01T08:00:00Z')

const message = (id: string, channelId: string, deleted = false): StoredMessage => ({
    id,
    channelId,
    type: 'regular',
    author: { id: 'tuan', username: 'tuan', displayName: 'Tuấn', avatarKey: null },
    content: 'Đề cương ôn tập giữa kỳ',
    systemEvent: null,
    systemData: null,
    systemUser: null,
    systemUsers: [],
    replyTo: null,
    mentionEveryone: false,
    mentionHereUserIds: [],
    mentionRoleIds: [],
    mentionUsers: [],
    attachments: [],
    editedAt: null,
    pinned: false,
    createdAt: new Date('2026-11-14T20:30:00Z'),
    deleted
})

/**
 * Server ÔT: #hoi-dap with m1 → m3 (m2 deleted), #trong with no message,
 * #ban-quan-ly private to moderators (Chi) with m9, a voice room. Bình is a
 * member who joined on 1/11; the read states keep only what was marked.
 */
function world() {
    const stored = new Map([
        ['m1', message('m1', 'hoi-dap')],
        ['m2', message('m2', 'hoi-dap', true)],
        ['m3', message('m3', 'hoi-dap')],
        ['m9', message('m9', 'ban-quan-ly')]
    ])
    const marks = new Map<string, string>()
    const asked: { userId: string; roleIds: string[]; channels: ReadScope[] }[] = []
    const readStates: ReadStateRepositoryPort = {
        readersPast: jest.fn(),
        markRead: jest.fn(async (userId: string, channelId: string, messageId: string) => {
            const key = `${userId}:${channelId}`
            if (!marks.has(key) || marks.get(key)! < messageId) marks.set(key, messageId)
        }),
        states: jest.fn(async (userId: string, roleIds: string[], channels: ReadScope[]) => {
            asked.push({ userId, roleIds, channels })
            return channels.map(({ channelId, floorId }) => {
                const mark = marks.get(`${userId}:${channelId}`)
                return { channelId, lastReadId: mark ?? floorId, unreadCount: 0, mentionCount: 0 }
            })
        })
    }
    const messages = {
        find: jest.fn(async (id: string) => stored.get(id) ?? null),
        latestId: jest.fn(
            async (channelId: string) =>
                [...stored.values()]
                    .filter((m) => m.channelId === channelId)
                    .map((m) => m.id)
                    .sort()
                    .pop() ?? null
        )
    } as unknown as MessageRepositoryPort
    const channels: ChannelDirectoryPort = {
        serverIdOf: jest.fn(async (id: string) => (server.channels.some((c) => c.id === id) ? 'ot' : null)),
        channelIdsOf: async () => []
    }
    const checker: PermissionCheckerPort = {
        access: jest.fn(async (_serverId: string, userId: string) => ({
            server,
            member: { userId, roleIds: userId === 'chi' ? ['quan-ly'] : [], timeoutUntil: null }
        }))
    }
    const membership: MembershipPort = {
        membersAmong: jest.fn(),
        channelMembers: jest.fn(),
        serverIdsOf: jest.fn(),
        membershipsOf: jest.fn(async () => [{ serverId: 'ot', joinedAt: JOINED }])
    }
    const events = { publish: jest.fn() }
    const handler = new AckChannelHandler(
        readStates,
        messages,
        channels,
        checker,
        membership,
        events as unknown as EventBus
    )
    const ack = (userId: string, channelId: string, messageId: string | null = null) =>
        handler.execute(new AckChannelCommand(userId, channelId, messageId))
    return { ack, marks, asked, events, readStates }
}

describe('AckChannelHandler (REQ-MSG-09, D-46, D-173)', () => {
    it('marks the channel read up to the message, tells the person, and answers with where they stand', async () => {
        const { ack, marks, events } = world()

        const state = await ack('binh', 'hoi-dap', 'm1')

        expect(marks.get('binh:hoi-dap')).toBe('m1')
        expect(state).toEqual({
            serverId: 'ot',
            channelId: 'hoi-dap',
            lastReadId: 'm1',
            unreadCount: 0,
            mentionCount: 0
        })
        expect(events.publish).toHaveBeenCalledTimes(1)
        expect(events.publish).toHaveBeenCalledWith(new ReadStateUpdatedEvent('binh', state))
    })

    it('with no message named, marks the newest message of the channel ("Mark as read")', async () => {
        const { ack, marks } = world()
        await ack('binh', 'hoi-dap')
        expect(marks.get('binh:hoi-dap')).toBe('m3')
    })

    it('marks a deleted message of the channel: it is still a place in it', async () => {
        const { ack, marks } = world()
        await ack('binh', 'hoi-dap', 'm2')
        expect(marks.get('binh:hoi-dap')).toBe('m2')
    })

    it('in a channel with no message marks nothing and tells no one', async () => {
        const { ack, readStates, events } = world()

        const state = await ack('binh', 'trong')

        expect(readStates.markRead).not.toHaveBeenCalled()
        expect(events.publish).not.toHaveBeenCalled()
        expect(state.lastReadId).toBe(readFloor(JOINED))
    })

    it('refuses a message of another channel: a far place would mark every later message read', async () => {
        const { ack, readStates } = world()
        await expect(ack('chi', 'hoi-dap', 'm9')).rejects.toBeInstanceOf(MessageNotFoundError)
        await expect(ack('binh', 'hoi-dap', 'khong-co')).rejects.toBeInstanceOf(MessageNotFoundError)
        expect(readStates.markRead).not.toHaveBeenCalled()
    })

    it('is NOT_FOUND in a channel the person may not view, or a voice room', async () => {
        const { ack, readStates } = world()
        await expect(ack('binh', 'ban-quan-ly', 'm9')).rejects.toBeInstanceOf(ChannelNotFoundError)
        await expect(ack('binh', 'phong-hoc')).rejects.toBeInstanceOf(ChannelNotFoundError)
        await expect(ack('binh', 'khong-co')).rejects.toBeInstanceOf(ChannelNotFoundError)
        expect(readStates.markRead).not.toHaveBeenCalled()
    })

    it('counts with the roles the person holds there and from when they joined (D-170)', async () => {
        const { ack, asked } = world()

        await ack('chi', 'ban-quan-ly', 'm9')

        expect(asked).toEqual([
            {
                userId: 'chi',
                roleIds: ['quan-ly'],
                channels: [{ channelId: 'ban-quan-ly', floorId: readFloor(JOINED) }]
            }
        ])
    })
})
