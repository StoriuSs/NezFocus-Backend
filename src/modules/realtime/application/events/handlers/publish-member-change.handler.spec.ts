import { AccessServer, EVERYONE_DEFAULT_PERMISSIONS, PermissionCheckerPort } from '@/modules/permissions'
import { ChannelDirectoryPort, MemberChangedEvent } from '@/modules/servers'
import { EventPublisherPort, PublishMemberChangeHandler, SocketRoomsPort } from '@/modules/realtime/application'
import { RoomMoves } from '../../services/room-moves'

const SERVER: AccessServer = {
    ownerId: 'an',
    roles: [{ id: 'e', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true }],
    channels: [{ id: 'general', type: 'text', isPrivate: false, viewRoleIds: [], sendMode: 'everyone' }]
}

/** Records, in order, what reaches the sockets: events told and rooms moved. */
function setUp({ inServer = true, moveFails = false } = {}) {
    const log: string[] = []
    const told = (to: string) => (id: string, event: string, data: object) =>
        log.push(`${event} to ${to}:${id} ${JSON.stringify(data)}`)
    const publisher = { toUser: told('user'), toServer: told('server') } as unknown as EventPublisherPort
    const rooms: SocketRoomsPort = {
        usersIn: jest.fn(),
        move: jest.fn(async (userId: string, leave: string[], join: string[]) => {
            if (moveFails) throw new Error('Redis down')
            log.push(`move ${userId} -${leave.join(',')} +${join.join(',')}`)
        })
    }
    const permissions = {
        access: async (_serverId: string, userId: string) =>
            inServer ? { server: SERVER, member: { userId, roleIds: [], timeoutUntil: null } } : null
    } as unknown as PermissionCheckerPort
    const channels = { channelIdsOf: async () => ['general'] } as unknown as ChannelDirectoryPort
    const handler = new PublishMemberChangeHandler(publisher, new RoomMoves(rooms, permissions, channels))
    return { log, rooms, handler }
}

describe('A member who joins, changes or leaves, told to the server (D-178)', () => {
    it('puts someone who joined in the rooms first, so their own tabs hear it too', async () => {
        const { log, handler } = setUp()

        await handler.handle(new MemberChangedEvent('s1', 'binh', 'joined'))

        expect(log).toEqual([
            'move binh - +server:s1,channel:general',
            'member.joined to server:s1 {"serverId":"s1","userId":"binh"}'
        ])
    })

    it('tells the one kicked why, alone, then takes them out, then tells the others without why', async () => {
        const { log, handler } = setUp({ inServer: false })

        await handler.handle(new MemberChangedEvent('s1', 'binh', 'left', 'kick', 'Spam'))

        expect(log).toEqual([
            'member.left to user:binh {"serverId":"s1","userId":"binh","removedBy":"kick","reason":"Spam"}',
            'move binh -server:s1,channel:general +',
            'member.left to server:s1 {"serverId":"s1","userId":"binh"}'
        ])
    })

    it('tells one who left by themselves on all their tabs, with no one removing them', async () => {
        const { log, handler } = setUp({ inServer: false })

        await handler.handle(new MemberChangedEvent('s1', 'binh', 'left'))

        expect(log[0]).toBe('member.left to user:binh {"serverId":"s1","userId":"binh","removedBy":null,"reason":null}')
    })

    it('moves a member whose roles or timeout changed, then tells the server', async () => {
        const { log, handler } = setUp()

        await handler.handle(new MemberChangedEvent('s1', 'binh', 'updated'))

        expect(log).toEqual([
            'move binh - +server:s1,channel:general',
            'member.updated to server:s1 {"serverId":"s1","userId":"binh"}'
        ])
    })

    it('still tells the server when the sockets cannot be moved, and does not throw', async () => {
        const { log, handler } = setUp({ moveFails: true })

        await expect(handler.handle(new MemberChangedEvent('s1', 'binh', 'updated'))).resolves.toBeUndefined()

        expect(log).toEqual(['member.updated to server:s1 {"serverId":"s1","userId":"binh"}'])
    })
})
