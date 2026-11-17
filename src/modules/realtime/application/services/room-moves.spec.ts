import { AccessServer, EVERYONE_DEFAULT_PERMISSIONS, PermissionCheckerPort, ServerAccess } from '@/modules/permissions'
import { ChannelDirectoryPort } from '@/modules/servers'
import { SocketRoomsPort } from '../ports'
import { RoomMoves } from './room-moves'

const server = (staffRole: string | null): AccessServer => ({
    ownerId: 'chi',
    roles: [
        { id: 'e', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true },
        { id: 'staff', permissions: 0n, position: 1, isEveryone: false }
    ],
    channels: [
        {
            id: 'staff',
            type: 'text',
            isPrivate: true,
            viewRoleIds: staffRole ? [staffRole] : [],
            sendMode: 'everyone',
            taskBoardEnabled: false
        }
    ]
})
const holding = (userId: string): ServerAccess => ({
    server: server('staff'),
    member: { userId, roleIds: ['staff'], timeoutUntil: null }
})
const lacking = (userId: string): ServerAccess => ({
    server: server('staff'),
    member: { userId, roleIds: [], timeoutUntil: null }
})

function setUp(access: PermissionCheckerPort['access']) {
    const moves: string[] = []
    const rooms: SocketRoomsPort = {
        usersIn: jest.fn(),
        move: jest.fn(
            async (userId: string, _leave: string[], join: string[]) => void moves.push(`${userId} +${join.join(',')}`)
        )
    }
    const channels = { channelIdsOf: async () => ['staff'] } as unknown as ChannelDirectoryPort
    return { moves, roomMoves: new RoomMoves(rooms, { access } as PermissionCheckerPort, channels) }
}

describe('Moving sockets between the rooms of a server (D-178)', () => {
    it('moves one person in turn, each move reading access when its turn comes: the last change wins', async () => {
        // A role given, then taken at once: the first read is slow and would let them in after the second.
        let reads = 0
        let releaseFirst!: () => void
        const firstHeld = new Promise<void>((resolve) => (releaseFirst = resolve))
        const { moves, roomMoves } = setUp(async (_serverId, userId) => {
            reads += 1
            if (reads === 1) {
                await firstHeld
                return holding(userId)
            }
            return lacking(userId)
        })

        const given = roomMoves.moveInto('s1', ['binh'])
        const taken = roomMoves.moveInto('s1', ['binh'])
        await new Promise((resolve) => setImmediate(resolve))
        expect(reads).toBe(1)
        releaseFirst()
        await Promise.all([given, taken])

        expect(moves).toEqual(['binh +server:s1,channel:staff', 'binh +server:s1'])
    })

    it('still moves the others when one cannot be, then says it failed', async () => {
        const { moves, roomMoves } = setUp(async (_serverId, userId) => {
            if (userId === 'an') throw new Error('Redis down')
            return lacking(userId)
        })

        await expect(roomMoves.moveInto('s1', ['an', 'binh'])).rejects.toThrow('1 of 2')

        expect(moves).toEqual(['binh +server:s1'])
    })
})
