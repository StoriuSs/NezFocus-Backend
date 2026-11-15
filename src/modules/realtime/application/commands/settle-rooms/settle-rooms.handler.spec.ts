import { MembershipPort } from '@/modules/servers'
import { RoomMoves } from '../../services/room-moves'
import { SettleRoomsCommand } from './settle-rooms.command'
import { SettleRoomsHandler } from './settle-rooms.handler'

describe('A socket just in its rooms (D-178)', () => {
    it('is moved again in every server it was put in, or is in now: a change while it connected is not missed', async () => {
        const moved: [string, string[]][] = []
        const roomMoves = {
            moveInto: jest.fn(async (serverId: string, userIds: string[]) => void moved.push([serverId, userIds]))
        } as unknown as RoomMoves
        // Left s1 while connecting, joined s3 meanwhile.
        const membership = { serverIdsOf: jest.fn(async () => ['s2', 's3']) } as unknown as MembershipPort

        await new SettleRoomsHandler(membership, roomMoves).execute(
            new SettleRoomsCommand('binh', ['user:binh', 'session:x', 'server:s1', 'channel:c1', 'server:s2'])
        )

        expect(moved.map(([serverId]) => serverId).sort()).toEqual(['s1', 's2', 's3'])
        expect(moved.every(([, userIds]) => userIds.length === 1 && userIds[0] === 'binh')).toBe(true)
    })

    it('does not throw when moving fails: the socket keeps the rooms it was given', async () => {
        const roomMoves = {
            moveInto: jest.fn(async () => Promise.reject(new Error('Redis down')))
        } as unknown as RoomMoves
        const membership = { serverIdsOf: jest.fn(async () => ['s2']) } as unknown as MembershipPort

        await expect(
            new SettleRoomsHandler(membership, roomMoves).execute(new SettleRoomsCommand('binh', ['server:s2']))
        ).resolves.toBeUndefined()
    })
})
