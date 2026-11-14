import { AccessServer, EVERYONE_DEFAULT_PERMISSIONS, PermissionCheckerPort } from '@/modules/permissions'
import { ChannelDirectoryPort, RoleDirectoryPort } from '@/modules/servers'
import { UserDirectoryPort } from '@/modules/users'
import { ChannelNotFoundError, MessageRecord, PinRepositoryPort, ReactionRepositoryPort } from '../../../domain'
import { ListPinsQuery } from './pin.queries'
import { ListPinsHandler } from './pin.handlers'

const server: AccessServer = {
    ownerId: 'an',
    roles: [{ id: 'everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true }],
    channels: [
        { id: 'hoi-dap', type: 'text', isPrivate: false, viewRoleIds: [], sendMode: 'everyone' },
        { id: 'ban-quan-ly', type: 'text', isPrivate: true, viewRoleIds: ['quan-ly'], sendMode: 'everyone' }
    ]
}

const record = (id: string, by: string): MessageRecord => ({
    id,
    channelId: 'hoi-dap',
    type: 'regular',
    author: { id: by, username: by, displayName: by, avatarKey: `avatars/${by}.webp` },
    content: `Tin ${id}`,
    systemEvent: null,
    systemData: null,
    replyTo: null,
    mentionEveryone: false,
    mentionRoleIds: [],
    mentionUsers: [],
    editedAt: null,
    pinned: true,
    systemUser: null,
    createdAt: new Date('2026-10-15T21:12:00Z')
})

function world() {
    const pins = {
        list: jest.fn(async () => [
            { message: record('m7', 'tuan'), pinnedAt: new Date('2026-10-16T20:31:00Z') },
            { message: record('m3', 'ha'), pinnedAt: new Date('2026-10-15T21:13:00Z') }
        ])
    }
    const reactions = { summaries: jest.fn(async () => new Map([['m3', [{ emoji: '👍', count: 4, me: true }]]])) }
    const channels: ChannelDirectoryPort = { serverIdOf: jest.fn(async () => 'ot') }
    const checker: PermissionCheckerPort = {
        access: jest.fn(async (_serverId: string, userId: string) => ({
            server,
            member: { userId, roleIds: [], timeoutUntil: null }
        }))
    }
    const users = { avatarUrl: jest.fn(async (key: string) => `https://cdn.test/${key}`) }
    const handler = new ListPinsHandler(
        pins as unknown as PinRepositoryPort,
        reactions as unknown as ReactionRepositoryPort,
        channels,
        checker,
        users as unknown as UserDirectoryPort,
        { rolesOf: jest.fn(async () => []) } as RoleDirectoryPort
    )
    return { handler, pins, reactions }
}

describe('ListPinsHandler (REQ-MSG-07, S-CHAT-02)', () => {
    it('gives the pins as the repository orders them (latest pinned first), each with when and its reactions', async () => {
        const { handler, pins, reactions } = world()

        const items = await handler.execute(new ListPinsQuery('binh', 'hoi-dap'))

        expect(pins.list).toHaveBeenCalledWith('hoi-dap')
        expect(reactions.summaries).toHaveBeenCalledWith(['m7', 'm3'], 'binh')
        expect(items.map((item) => [item.id, item.pinnedAt.toISOString(), item.reactions.length])).toEqual([
            ['m7', '2026-10-16T20:31:00.000Z', 0],
            ['m3', '2026-10-15T21:13:00.000Z', 1]
        ])
        expect(items[0]?.author?.avatarUrl).toBe('https://cdn.test/avatars/tuan.webp')
    })

    it('answers not found for a channel they do not see', async () => {
        const { handler, pins } = world()
        await expect(handler.execute(new ListPinsQuery('binh', 'ban-quan-ly'))).rejects.toBeInstanceOf(
            ChannelNotFoundError
        )
        expect(pins.list).not.toHaveBeenCalled()
    })
})
