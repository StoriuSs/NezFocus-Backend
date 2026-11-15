import { AccessServer, EVERYONE_DEFAULT_PERMISSIONS, PermissionCheckerPort } from '@/modules/permissions'
import { ChannelDirectoryPort, ServerChangedEvent } from '@/modules/servers'
import { EventPublisherPort, PublishServerChangeHandler, SocketRoomsPort } from '@/modules/realtime/application'
import { RoomMoves } from '../../services/room-moves'

const SERVER: AccessServer = {
    ownerId: 'chi',
    roles: [{ id: 'e', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true }],
    channels: [
        { id: 'general', type: 'text', isPrivate: false, viewRoleIds: [], sendMode: 'everyone' },
        { id: 'staff', type: 'text', isPrivate: true, viewRoleIds: [], sendMode: 'everyone' }
    ]
}

/** Records, in order, what reaches the sockets: events told and rooms moved. */
function setUp({ members = ['an', 'binh'], moveFails = false } = {}) {
    const log: string[] = []
    const publisher = {
        toServer: (serverId: string, event: string, data: object) =>
            log.push(`${event} to ${serverId} ${JSON.stringify(data)}`)
    } as unknown as EventPublisherPort
    const rooms: SocketRoomsPort = {
        usersIn: jest.fn(async () => ['an', 'binh']),
        move: jest.fn(async (userId: string, leave: string[], join: string[]) => {
            if (moveFails) throw new Error('Redis down')
            log.push(`move ${userId} -${leave.join(',')} +${join.join(',')}`)
        })
    }
    const permissions = {
        access: async (_serverId: string, userId: string) =>
            members.includes(userId) ? { server: SERVER, member: { userId, roleIds: [], timeoutUntil: null } } : null
    } as unknown as PermissionCheckerPort
    const channels = { channelIdsOf: async () => ['general', 'staff'] } as unknown as ChannelDirectoryPort
    const handler = new PublishServerChangeHandler(publisher, rooms, new RoomMoves(rooms, permissions, channels))
    return { log, rooms, handler }
}

describe('A change to a server, told to its members (D-178)', () => {
    it('tells each change by the server alone, moving no socket when no one may view anything new', async () => {
        const { log, rooms, handler } = setUp()

        await handler.handle(
            new ServerChangedEvent(
                's1',
                [
                    { topic: 'category', action: 'deleted' },
                    { topic: 'channel', action: 'updated' }
                ],
                false
            )
        )

        expect(log).toEqual(['category.deleted to s1 {"serverId":"s1"}', 'channel.updated to s1 {"serverId":"s1"}'])
        expect(rooms.usersIn).not.toHaveBeenCalled()
    })

    it('moves everyone in the server to the rooms they may view now, before telling them', async () => {
        const { log, rooms, handler } = setUp({ members: ['an'] })

        await handler.handle(new ServerChangedEvent('s1', [{ topic: 'channel', action: 'created' }], true))

        expect(rooms.usersIn).toHaveBeenCalledWith('server:s1')
        expect(log).toEqual([
            'move an -channel:staff +server:s1,channel:general',
            'move binh -server:s1,channel:general,channel:staff +',
            'channel.created to s1 {"serverId":"s1"}'
        ])
    })

    it('tells a deleted server first, then takes every socket out of its rooms', async () => {
        const { log, handler } = setUp({ members: [] })

        await handler.handle(new ServerChangedEvent('s1', [{ topic: 'server', action: 'deleted' }], true))

        expect(log[0]).toBe('server.deleted to s1 {"serverId":"s1"}')
        expect(log.slice(1)).toEqual([
            'move an -server:s1,channel:general,channel:staff +',
            'move binh -server:s1,channel:general,channel:staff +'
        ])
    })

    it('still tells the change when the sockets cannot be moved, and does not throw', async () => {
        const { log, handler } = setUp({ moveFails: true })

        await expect(
            handler.handle(new ServerChangedEvent('s1', [{ topic: 'role', action: 'updated' }], true))
        ).resolves.toBeUndefined()

        expect(log).toEqual(['role.updated to s1 {"serverId":"s1"}'])
    })
})
