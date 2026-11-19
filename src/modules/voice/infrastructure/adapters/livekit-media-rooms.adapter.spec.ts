import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { RoomServiceClient, ServerError, TokenVerifier, TrackSource } from 'livekit-server-sdk'
import { MediaRoomsUnavailableError } from '@/modules/voice/domain'
import { LiveKitMediaRooms } from './livekit-media-rooms.adapter'

// What the adapter signs, read back with the same key, and what it makes of
// LiveKit's answers. Whether LiveKit takes the tokens, and its real answers,
// are in test/integration/voice-http.
const livekit = { url: 'ws://127.0.0.1:1', apiKey: 'devkey', apiSecret: 'secret' }
const adapter = () => new LiveKitMediaRooms(new ConfigService({ livekit }))
const claims = (token: string) => new TokenVerifier(livekit.apiKey, livekit.apiSecret).verify(token)

describe('LiveKitMediaRooms join tokens (D-210)', () => {
    it('is for one room and person, ten minutes to join, sending what they may and no data', async () => {
        const { token, url } = await adapter().issueJoinToken({
            room: 'voice:c1',
            identity: 'user-1',
            name: 'An',
            sources: ['microphone', 'camera', 'screen_share', 'screen_share_audio']
        })

        expect(url).toBe(livekit.url)
        const granted = await claims(token)
        expect(granted).toMatchObject({ sub: 'user-1', name: 'An' })
        expect(granted.exp! - granted.nbf!).toBe(600)
        expect(granted.video).toEqual({
            roomJoin: true,
            room: 'voice:c1',
            canSubscribe: true,
            canPublish: true,
            canPublishSources: ['microphone', 'camera', 'screen_share', 'screen_share_audio'],
            canPublishData: false
        })
    })

    it('lets someone without SPEAK or VIDEO listen only', async () => {
        const { token } = await adapter().issueJoinToken({
            room: 'voice:c1',
            identity: 'user-2',
            name: 'Bình',
            sources: []
        })

        expect((await claims(token)).video).toMatchObject({
            canSubscribe: true,
            canPublish: false,
            canPublishSources: []
        })
    })

    it('sends only the sources it is given: SPEAK alone is the microphone', async () => {
        const { token } = await adapter().issueJoinToken({
            room: 'voice:c1',
            identity: 'user-3',
            name: 'Chi',
            sources: ['microphone']
        })

        expect((await claims(token)).video).toMatchObject({ canPublish: true, canPublishSources: ['microphone'] })
    })
})

describe('LiveKitMediaRooms asking LiveKit', () => {
    afterEach(() => jest.restoreAllMocks())
    /** LiveKit's answer to each call, made when the call comes. */
    const answers = (
        method:
            | 'listParticipants'
            | 'removeParticipant'
            | 'updateParticipant'
            | 'mutePublishedTrack'
            | 'getParticipant',
        outcome: () => Promise<unknown>
    ) => jest.spyOn(RoomServiceClient.prototype, method).mockImplementation(outcome as never)
    const logged = (level: 'warn' | 'error') => jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined)

    it('lists who is in a room, with when they joined and whether they send a screen (D-101)', async () => {
        answers('listParticipants', async () => [
            { identity: 'user-1', sid: 'PA_1', joinedAtMs: 1795000000123n, tracks: [] },
            {
                identity: 'user-2',
                sid: 'PA_2',
                joinedAtMs: 1795000000456n,
                tracks: [{ source: TrackSource.MICROPHONE }, { source: TrackSource.SCREEN_SHARE }]
            },
            // Its sound alone is no screen, nor is a muted one (a second screen in the room, stopped).
            {
                identity: 'user-3',
                sid: 'PA_3',
                joinedAtMs: 1795000000789n,
                tracks: [{ source: TrackSource.SCREEN_SHARE_AUDIO }]
            },
            {
                identity: 'user-4',
                sid: 'PA_4',
                joinedAtMs: 1795000000999n,
                tracks: [{ source: TrackSource.SCREEN_SHARE, muted: true }]
            }
        ])

        expect(await adapter().listParticipants('voice:c1')).toEqual([
            { identity: 'user-1', sid: 'PA_1', joinedAt: new Date(1795000000123), sharing: false },
            { identity: 'user-2', sid: 'PA_2', joinedAt: new Date(1795000000456), sharing: true },
            { identity: 'user-3', sid: 'PA_3', joinedAt: new Date(1795000000789), sharing: false },
            { identity: 'user-4', sid: 'PA_4', joinedAt: new Date(1795000000999), sharing: false }
        ])
    })

    it("mutes one track of a person's, nothing when it or they are gone, and reports LiveKit out of reach", async () => {
        logged('warn')
        const holding = answers('getParticipant', async () => ({ tracks: [{ sid: 'TR_0' }, { sid: 'TR_1' }] }))
        const mute = answers('mutePublishedTrack', async () => ({}))
        await adapter().muteTrack('voice:c1', 'user-1', 'TR_1')
        expect(holding).toHaveBeenCalledWith('voice:c1', 'user-1')
        expect(mute).toHaveBeenCalledWith('voice:c1', 'user-1', 'TR_1', true)

        // Gone: LiveKit is not asked to mute, which would wait seconds to say "unavailable".
        mute.mockClear()
        await adapter().muteTrack('voice:c1', 'user-1', 'TR_gone')
        answers('getParticipant', () =>
            Promise.reject(new ServerError('not_found', 'participant does not exist', 404, 'not_found'))
        )
        await expect(adapter().muteTrack('voice:c1', 'user-1', 'TR_1')).resolves.toBeUndefined()
        expect(mute).not.toHaveBeenCalled()

        answers('getParticipant', async () => ({ tracks: [{ sid: 'TR_1' }] }))

        answers('mutePublishedTrack', () => Promise.reject(new Error('connect ECONNREFUSED')))
        await expect(adapter().muteTrack('voice:c1', 'user-1', 'TR_1')).rejects.toBeInstanceOf(
            MediaRoomsUnavailableError
        )
    })

    it('changes what a person may send: the whole permission, as a join token gives it (D-207)', async () => {
        const update = answers('updateParticipant', async () => ({}))

        await adapter().setSources('voice:c1', 'user-1', ['camera', 'screen_share'])

        expect(update).toHaveBeenCalledWith('voice:c1', 'user-1', {
            permission: {
                canSubscribe: true,
                canPublish: true,
                canPublishSources: [TrackSource.CAMERA, TrackSource.SCREEN_SHARE],
                canPublishData: false
            }
        })
    })

    it('changes nothing for a person already gone, and reports LiveKit out of reach', async () => {
        logged('warn')
        answers('updateParticipant', () =>
            Promise.reject(new ServerError('not_found', 'participant not found', 404, 'not_found'))
        )
        await expect(adapter().setSources('voice:c1', 'user-1', [])).resolves.toBeUndefined()

        answers('updateParticipant', () => Promise.reject(new Error('connect ECONNREFUSED')))
        await expect(adapter().setSources('voice:c1', 'user-1', [])).rejects.toBeInstanceOf(MediaRoomsUnavailableError)
    })

    it('takes "not found" for an empty room, and for a person already gone', async () => {
        const notFound = () => Promise.reject(new ServerError('not_found', 'room does not exist', 404, 'not_found'))
        answers('listParticipants', notFound)
        answers('removeParticipant', notFound)

        expect(await adapter().listParticipants('voice:c1')).toEqual([])
        await expect(adapter().removeParticipant('voice:c1', 'user-1')).resolves.toBe(false)
    })

    it('reports LiveKit out of reach as unavailable, not as an empty room or a person gone, and logs why', async () => {
        const warn = logged('warn')

        await expect(adapter().listParticipants('voice:c1')).rejects.toBeInstanceOf(MediaRoomsUnavailableError)
        await expect(adapter().removeParticipant('voice:c1', 'user-1')).rejects.toBeInstanceOf(
            MediaRoomsUnavailableError
        )
        expect(warn).toHaveBeenCalledTimes(2)
        expect(warn.mock.calls[0]![0]).toContain('voice:c1')
    })

    it('logs a refused key as an error naming the settings: waiting will not fix it', async () => {
        const error = logged('error')
        answers('listParticipants', () =>
            Promise.reject(new ServerError('unauthenticated', 'invalid token', 401, 'unauthenticated'))
        )

        await expect(adapter().listParticipants('voice:c1')).rejects.toBeInstanceOf(MediaRoomsUnavailableError)
        expect(error).toHaveBeenCalledWith(expect.stringContaining('LIVEKIT_API_SECRET'))
    })
})
