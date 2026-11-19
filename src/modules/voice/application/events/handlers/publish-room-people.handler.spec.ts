import { AccessServer, PermissionCheckerPort } from '@/modules/permissions'
import { EventPublisherPort } from '@/modules/realtime'
import { ChannelDirectoryPort } from '@/modules/servers'
import { UserDirectoryPort } from '@/modules/users'
import { RoomOccupant, VoiceStateRepositoryPort } from '../../../domain'
import { VoiceStateChangedEvent } from '../voice-state-changed.event'
import { PublishRoomPeopleHandler } from './publish-room-people.handler'

const LOUNGE = '0190a000-0000-7000-8000-00000000000a'
const JOINED = new Date('2026-11-18T10:00:00Z')
const occupant: RoomOccupant = {
    userId: 'an',
    channelId: LOUNGE,
    participantSid: 'PA_1',
    joinedAt: JOINED,
    micOn: true,
    cameraOn: false,
    screenSharing: false,
    modMuted: false,
    person: { id: 'an', username: 'an', displayName: 'An', avatarKey: 'avatars/an.webp' }
}

describe("A voice room's people (D-205)", () => {
    it("are read and told to the room while the room's lock is held, the whole list with pictures as addresses", async () => {
        const steps: string[] = []
        const states = {
            tellOccupants: jest.fn(async (_channelId: string, tell: (occupants: RoomOccupant[]) => Promise<void>) => {
                steps.push('locked')
                await tell([occupant])
                steps.push('released')
            })
        }
        const users = { avatarUrl: jest.fn(async (key: string | null) => (key ? `https://cdn.test/${key}` : null)) }
        const publisher = { toChannel: jest.fn(() => steps.push('told')) }
        const handler = new PublishRoomPeopleHandler(
            states as unknown as VoiceStateRepositoryPort,
            users as unknown as UserDirectoryPort,
            publisher as unknown as EventPublisherPort,
            {
                serverIdOf: jest.fn(async () => {
                    steps.push('server read')
                    return 's1'
                })
            } as unknown as ChannelDirectoryPort,
            {
                access: jest.fn().mockResolvedValue({
                    server: { ownerId: 'owner' } as AccessServer,
                    member: { userId: 'an', roleIds: ['r1'], timeoutUntil: null }
                })
            } as unknown as PermissionCheckerPort
        )

        await handler.handle(new VoiceStateChangedEvent(LOUNGE, 'an', 'updated', JOINED))

        expect(states.tellOccupants).toHaveBeenCalledWith(LOUNGE, expect.any(Function))
        // The database is read before the lock: under it, only the rows and the permission cache.
        expect(steps).toEqual(['server read', 'locked', 'told', 'released'])
        expect(publisher.toChannel).toHaveBeenCalledWith(LOUNGE, 'voice_state.updated', {
            channelId: LOUNGE,
            voiceStates: [
                {
                    user: {
                        id: 'an',
                        username: 'an',
                        displayName: 'An',
                        avatarUrl: 'https://cdn.test/avatars/an.webp'
                    },
                    roleIds: ['r1'],
                    isOwner: false,
                    joinedAt: JOINED,
                    micOn: true,
                    cameraOn: false,
                    screenSharing: false,
                    modMuted: false
                }
            ]
        })
    })
})
