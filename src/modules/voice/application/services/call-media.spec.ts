import { EventBus } from '@nestjs/cqrs'
import { UserDirectoryPort } from '@/modules/users'
import { VoiceState, VoiceStateRepositoryPort, VoiceWrite } from '../../domain'
import { VoiceStateChangedEvent } from '../events/voice-state-changed.event'
import { MediaRoomsPort } from '../ports'
import { CallMedia } from './call-media'

const CALL = '0190a000-0000-7000-8000-0000000000c1'
const LOUNGE = '0190a000-0000-7000-8000-00000000000a'
const joinedAt = new Date(Date.UTC(2026, 10, 24, 21, 44, 0))

function setUp(current: VoiceState | null = null) {
    const media = {
        issueJoinToken: jest.fn().mockResolvedValue({ token: 'jwt', url: 'ws://localhost:7880' }),
        removeParticipant: jest.fn().mockResolvedValue(true),
        removeConnection: jest.fn().mockResolvedValue(true),
        listParticipants: jest.fn().mockResolvedValue([]),
        listRooms: jest.fn().mockResolvedValue([]),
        closeRoom: jest.fn().mockResolvedValue(undefined)
    }
    const states = {
        find: jest.fn().mockResolvedValue(current),
        change: jest.fn(async (_userId: string, decide: (state: VoiceState | null) => VoiceWrite | null) => {
            const write = decide(current)
            return write?.kind === 'remove' ? { before: current, after: null } : null
        })
    }
    const users = {
        findById: jest.fn().mockResolvedValue({
            id: 'an',
            displayName: 'An',
            username: 'an',
            deletedAt: null,
            deletionRequestedAt: null
        })
    }
    const events = { publish: jest.fn() }
    const callMedia = new CallMedia(
        media as unknown as MediaRoomsPort,
        states as unknown as VoiceStateRepositoryPort,
        users as unknown as UserDirectoryPort,
        events as unknown as EventBus
    )
    return { callMedia, media, states, events }
}

describe('CallMedia: the rooms of one-to-one calls (D-239, D-242)', () => {
    it('gives a token for the call room, sending the microphone and the camera, with the session asking', async () => {
        const { callMedia, media } = setUp()

        await expect(callMedia.joinToken(CALL, 'an', 'session-an')).resolves.toEqual({
            token: 'jwt',
            url: 'ws://localhost:7880'
        })
        expect(media.issueJoinToken).toHaveBeenCalledWith({
            room: `call:${CALL}`,
            identity: 'an',
            name: 'An',
            sources: ['microphone', 'camera'],
            sessionId: 'session-an'
        })
    })

    it('takes someone in a voice room out of it first: one media connection per account (D-210)', async () => {
        const inRoom: VoiceState = {
            userId: 'an',
            channelId: LOUNGE,
            participantSid: 'PA_room',
            joinedAt,
            sessionId: 'session-an',
            micOn: true,
            cameraOn: false,
            screenSharing: false,
            modMuted: false
        }
        const { callMedia, media, events } = setUp(inRoom)

        await callMedia.joinToken(CALL, 'an', 'session-an')

        expect(media.removeParticipant).toHaveBeenCalledWith(`voice:${LOUNGE}`, 'an')
        expect(events.publish).toHaveBeenCalledWith(expect.any(VoiceStateChangedEvent))
        expect(media.removeParticipant.mock.invocationCallOrder[0]).toBeLessThan(
            media.issueJoinToken.mock.invocationCallOrder[0]
        )
    })

    it('lists who is in a call room, and the calls LiveKit has a room for, no voice room among them', async () => {
        const { callMedia, media } = setUp()
        media.listParticipants.mockResolvedValue([
            { identity: 'an', sid: 'PA_an', joinedAt, sessionId: 'session-an', sharing: false }
        ])
        media.listRooms.mockResolvedValue([`call:${CALL}`, `voice:${LOUNGE}`, 'call:probe'])

        await expect(callMedia.participants(CALL)).resolves.toEqual([
            { userId: 'an', participantSid: 'PA_an', joinedAt, sessionId: 'session-an' }
        ])
        expect(media.listParticipants).toHaveBeenCalledWith(`call:${CALL}`)
        await expect(callMedia.rooms()).resolves.toEqual([CALL])
    })

    it('puts one connection out of a call room, and closes it', async () => {
        const { callMedia, media } = setUp()

        await expect(callMedia.removeConnection(CALL, 'an', 'PA_an')).resolves.toBe(true)
        await callMedia.close(CALL)

        expect(media.removeConnection).toHaveBeenCalledWith(`call:${CALL}`, 'an', 'PA_an')
        expect(media.closeRoom).toHaveBeenCalledWith(`call:${CALL}`)
    })
})
