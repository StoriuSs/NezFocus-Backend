import { UserDirectoryPort } from '@/modules/users'
import { RoomOccupant, VoiceStateRepositoryPort } from '../../../domain'
import { ListRoomPeopleHandler } from './room.handlers'
import { ListRoomPeopleQuery } from './room.queries'

const LOUNGE = '0190a000-0000-7000-8000-00000000000a'
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
            users as unknown as UserDirectoryPort
        )

        const people = await handler.execute(new ListRoomPeopleQuery([LOUNGE, 'empty']))

        expect(states.occupantsOf).toHaveBeenCalledWith([LOUNGE, 'empty'])
        expect([...people.entries()]).toEqual([
            [
                LOUNGE,
                [
                    {
                        user: { id: 'an', username: null, displayName: null, avatarUrl: null },
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
})
