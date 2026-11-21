import { createHash } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import { AccessToken } from 'livekit-server-sdk'
import { MediaEventRejectedError } from '@/modules/voice/domain'
import { LiveKitMediaEvents } from './livekit-media-events.adapter'

// What the adapter makes of LiveKit's webhooks, signed here as LiveKit signs
// them. That the route takes them whole is in test/integration/voice-http.
const livekit = { apiKey: 'devkey', apiSecret: 'secret' }
const adapter = () => new LiveKitMediaEvents(new ConfigService({ livekit }))

async function signed(event: object, secret = livekit.apiSecret): Promise<[string, string]> {
    const body = JSON.stringify(event)
    const signer = new AccessToken(livekit.apiKey, secret)
    signer.sha256 = createHash('sha256').update(body).digest('base64')
    return [body, await signer.toJwt()]
}

const room = { sid: 'RM_1', name: 'voice:c1' }
const participant = { sid: 'PA_1', identity: 'user-1', joinedAt: '1795000000', joinedAtMs: '1795000000123' }
const track = (source: string) => ({ sid: 'TR_1', type: source === 'SCREEN_SHARE_AUDIO' ? 'AUDIO' : 'VIDEO', source })

describe('LiveKitMediaEvents (D-210)', () => {
    it('reads who joined and left, and the sign-in session of their token (D-214)', async () => {
        const read = await adapter().read(
            ...(await signed({
                event: 'participant_joined',
                id: 'EV_1',
                room,
                participant: { ...participant, attributes: { session_id: 'session-1' } }
            }))
        )

        expect(read).toEqual({
            id: 'EV_1',
            kind: 'joined',
            room: 'voice:c1',
            identity: 'user-1',
            participantSid: 'PA_1',
            joinedAt: new Date(1795000000123),
            sessionId: 'session-1'
        })
        // A token from before the attribute: no session known.
        const older = await adapter().read(
            ...(await signed({ event: 'participant_left', id: 'EV_1b', room, participant }))
        )
        expect(older).toMatchObject({ kind: 'left', sessionId: null })
    })

    it('marks a leave the server caused as removed, and no other (D-228)', async () => {
        const left = async (disconnectReason?: string) =>
            adapter().read(
                ...(await signed({
                    event: 'participant_left',
                    id: 'EV_9',
                    room,
                    participant: { ...participant, disconnectReason }
                }))
            )
        for (const reason of ['PARTICIPANT_REMOVED', 'ROOM_DELETED']) {
            expect(await left(reason)).toMatchObject({ kind: 'left', removed: true })
        }
        for (const reason of ['CLIENT_INITIATED', 'DUPLICATE_IDENTITY', 'SIGNAL_CLOSE', undefined]) {
            expect(await left(reason)).not.toHaveProperty('removed')
        }
    })

    it('reads a screen started and stopped, with its track (D-101)', async () => {
        for (const [event, kind] of [
            ['track_published', 'share_started'],
            ['track_unpublished', 'share_stopped']
        ] as const) {
            const read = await adapter().read(
                ...(await signed({ event, id: 'EV_2', room, participant, track: track('SCREEN_SHARE') }))
            )
            expect(read).toEqual({
                id: 'EV_2',
                kind,
                room: 'voice:c1',
                identity: 'user-1',
                participantSid: 'PA_1',
                trackSid: 'TR_1'
            })
        }
    })

    it("leaves any other track alone, a screen's sound included", async () => {
        for (const source of ['MICROPHONE', 'CAMERA', 'SCREEN_SHARE_AUDIO']) {
            const read = await adapter().read(
                ...(await signed({ event: 'track_published', id: 'EV_3', room, participant, track: track(source) }))
            )
            expect(read).toEqual({ id: 'EV_3', kind: 'other' })
        }
    })

    it('refuses a body not signed with our secret', async () => {
        await expect(
            adapter().read(...(await signed({ event: 'participant_joined', id: 'EV_4', room, participant }, 'other')))
        ).rejects.toBeInstanceOf(MediaEventRejectedError)
    })
})
