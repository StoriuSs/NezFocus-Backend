import { AccessServer, PermissionCheckerPort } from '@/modules/permissions'
import { ChannelDirectoryPort } from '@/modules/servers'
import { UserDirectoryPort } from '@/modules/users'
import { RoomOccupant, VoiceStateRepositoryPort } from '../../../domain'
import { ListRoomPeopleHandler } from './room.handlers'
import { ListRoomPeopleQuery } from './room.queries'

const LOUNGE = '0190a000-0000-7000-8000-00000000000a'
const OTHER = '0190a000-0000-7000-8000-00000000000b'
const JOINED = new Date('2026-11-18T10:00:00Z')

describe('The people of voice rooms, for GET /servers (D-205)', () => {
    it('are listed for every room asked, an empty one too, a deleted account with no name or picture', async () => {
        const gone: RoomOccupant = {
            userId: 'an',
            channelId: LOUNGE,
            participantSid: 'PA_1',
            joinedAt: JOINED,
            micOn: false,
            cameraOn: false,
            screenSharing: false,
            modMuted: false,
            person: { id: 'an', username: null, displayName: null, avatarKey: null }
        }
        const states = { occupantsOf: jest.fn().mockResolvedValue([gone]) }
        const users = { avatarUrl: jest.fn().mockResolvedValue(null) }
        const handler = new ListRoomPeopleHandler(
            states as unknown as VoiceStateRepositoryPort,
            users as unknown as UserDirectoryPort,
            { serverIdOf: jest.fn().mockResolvedValue('s1') } as unknown as ChannelDirectoryPort,
            { access: jest.fn().mockResolvedValue(null) } as unknown as PermissionCheckerPort
        )

        const people = await handler.execute(new ListRoomPeopleQuery([LOUNGE, 'empty']))

        expect(states.occupantsOf).toHaveBeenCalledWith([LOUNGE, 'empty'])
        expect([...people.entries()]).toEqual([
            [
                LOUNGE,
                [
                    {
                        user: { id: 'an', username: null, displayName: null, avatarUrl: null },
                        roleIds: [],
                        isOwner: false,
                        joinedAt: JOINED,
                        micOn: false,
                        cameraOn: false,
                        screenSharing: false,
                        modMuted: false
                    }
                ]
            ],
            ['empty', []]
        ])
    })

    it("carry each one's roles in the server and whether they own it, for the moderators' menus (D-205, D-208)", async () => {
        const occupant = (userId: string, channelId: string): RoomOccupant => ({
            userId,
            channelId,
            participantSid: `PA_${userId}`,
            joinedAt: JOINED,
            micOn: false,
            cameraOn: false,
            screenSharing: false,
            modMuted: false,
            person: { id: userId, username: userId, displayName: null, avatarKey: null }
        })
        const server = { ownerId: 'owner', roles: [], channels: [] } as unknown as AccessServer
        const roles: Record<string, string[]> = { owner: [], an: ['r1', 'r2'] }
        const channels = { serverIdOf: jest.fn(async (channelId: string) => (channelId === LOUNGE ? 's1' : 's2')) }
        const checker = {
            access: jest.fn(async (_serverId: string, userId: string) =>
                userId in roles ? { server, member: { userId, roleIds: roles[userId], timeoutUntil: null } } : null
            )
        }
        const handler = new ListRoomPeopleHandler(
            {
                occupantsOf: jest.fn().mockResolvedValue([occupant('owner', LOUNGE), occupant('an', OTHER)])
            } as unknown as VoiceStateRepositoryPort,
            { avatarUrl: jest.fn().mockResolvedValue(null) } as unknown as UserDirectoryPort,
            channels as unknown as ChannelDirectoryPort,
            checker as unknown as PermissionCheckerPort
        )

        const people = await handler.execute(new ListRoomPeopleQuery([LOUNGE, OTHER]))

        expect(people.get(LOUNGE)).toEqual([expect.objectContaining({ roleIds: [], isOwner: true })])
        expect(people.get(OTHER)).toEqual([expect.objectContaining({ roleIds: ['r1', 'r2'], isOwner: false })])
        expect(checker.access).toHaveBeenCalledWith('s1', 'owner')
        expect(checker.access).toHaveBeenCalledWith('s2', 'an')
    })
})
