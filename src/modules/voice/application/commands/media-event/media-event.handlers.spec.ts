import { EventBus } from '@nestjs/cqrs'
import { AccessServer, EVERYONE_DEFAULT_PERMISSIONS, Permission, PermissionCheckerPort } from '@/modules/permissions'
import { EventPublisherPort } from '@/modules/realtime'
import { ChannelDirectoryPort } from '@/modules/servers'
import {
    MediaEventRejectedError,
    ScreenAlreadySharedError,
    VoiceState,
    VoiceStateRepositoryPort,
    VoiceWrite
} from '../../../domain'
import { VoiceStateChangedEvent } from '../../events/voice-state-changed.event'
import { EventReceiptsPort, MediaEvent, MediaEventsPort, MediaRoomsPort } from '../../ports'
import { ApplyMediaEventCommand } from './media-event.commands'
import { ApplyMediaEventHandler } from './media-event.handlers'

const LOUNGE = '0190a000-0000-7000-8000-00000000000a'
const STUDY = '0190a000-0000-7000-8000-00000000000b'
const at = (seconds: number) => new Date(Date.UTC(2026, 10, 18, 10, 0, seconds))
const joined = (over: Partial<Extract<MediaEvent, { kind: 'joined' | 'left' }>> = {}): MediaEvent => ({
    id: 'EV_1',
    kind: 'joined',
    room: `voice:${LOUNGE}`,
    identity: 'an',
    participantSid: 'PA_new',
    joinedAt: at(10),
    ...over
})
const share = (over: Partial<Extract<MediaEvent, { kind: 'share_started' | 'share_stopped' }>> = {}): MediaEvent => ({
    id: 'EV_S',
    kind: 'share_started',
    room: `voice:${LOUNGE}`,
    identity: 'an',
    participantSid: 'PA_old',
    trackSid: 'TR_screen',
    ...over
})
const row = (over: Partial<VoiceState> = {}): VoiceState => ({
    userId: 'an',
    channelId: LOUNGE,
    participantSid: 'PA_old',
    joinedAt: at(0),
    micOn: false,
    cameraOn: false,
    screenSharing: false,
    modMuted: false,
    ...over
})

/** A repository holding one person's row, written as the real one would. */
function setup(event: MediaEvent | Error, current: VoiceState | null = null, everyone = EVERYONE_DEFAULT_PERMISSIONS) {
    const mediaEvents = {
        read: jest.fn(() => (event instanceof Error ? Promise.reject(event) : Promise.resolve(event)))
    }
    const receipts = { firstSight: jest.fn().mockResolvedValue(true), forget: jest.fn().mockResolvedValue(undefined) }
    const media = {
        removeParticipant: jest.fn().mockResolvedValue(true),
        muteTrack: jest.fn().mockResolvedValue(undefined)
    }
    const server = {
        ownerId: 'owner',
        roles: [{ id: 'everyone', permissions: everyone, position: 0, isEveryone: true }],
        channels: [LOUNGE, STUDY].map((id) => ({
            id,
            type: 'voice',
            isPrivate: false,
            viewRoleIds: [],
            sendMode: 'everyone',
            taskBoardEnabled: false
        }))
    } as AccessServer
    const channels = { serverIdOf: jest.fn().mockResolvedValue('s1') }
    const checker = {
        access: jest.fn().mockResolvedValue({ server, member: { userId: 'an', roleIds: [], timeoutUntil: null } })
    }
    const publisher = { toUser: jest.fn() }
    const states = {
        change: jest.fn(async (_userId: string, decide: (state: VoiceState | null) => VoiceWrite | null) => {
            const write = decide(current)
            if (!write) return null
            if (write.kind === 'remove') return { before: current, after: null }
            if (write.kind === 'put') {
                const after: VoiceState = { ...row(), ...write.connection, micOn: false, cameraOn: false }
                return { before: current, after }
            }
            if (!current) return null
            return { before: current, after: { ...current, ...write.flags } }
        })
    }
    const events = { publish: jest.fn() }
    const handler = new ApplyMediaEventHandler(
        mediaEvents as unknown as MediaEventsPort,
        receipts as unknown as EventReceiptsPort,
        media as unknown as MediaRoomsPort,
        states as unknown as VoiceStateRepositoryPort,
        channels as unknown as ChannelDirectoryPort,
        checker as unknown as PermissionCheckerPort,
        publisher as unknown as EventPublisherPort,
        events as unknown as EventBus
    )
    const run = () => handler.execute(new ApplyMediaEventCommand('{"event":"…"}', 'Bearer jwt'))
    return { run, mediaEvents, receipts, media, states, events, channels, checker, publisher }
}

describe("LiveKit's webhooks (D-210)", () => {
    it('puts out at once, never listed, someone who joined a room they may no longer be in (D-212)', async () => {
        const { run, media, states, publisher } = setup(
            joined(),
            null,
            EVERYONE_DEFAULT_PERMISSIONS & ~Permission.CONNECT
        )

        await run()

        expect(media.removeParticipant).toHaveBeenCalledWith(`voice:${LOUNGE}`, 'an')
        expect(publisher.toUser).toHaveBeenCalledWith('an', 'voice.disconnected', {
            channelId: LOUNGE,
            reason: 'permission'
        })
        expect(states.change).not.toHaveBeenCalled()
    })

    it('puts out one who joined after leaving the server (a token used after a ban), and a deleted room', async () => {
        const banned = setup(joined())
        banned.checker.access.mockResolvedValue(null)
        await banned.run()
        expect(banned.publisher.toUser).toHaveBeenCalledWith('an', 'voice.disconnected', {
            channelId: LOUNGE,
            reason: 'server_left'
        })

        const deleted = setup(joined())
        deleted.channels.serverIdOf.mockResolvedValue(null)
        await deleted.run()
        expect(deleted.publisher.toUser).toHaveBeenCalledWith('an', 'voice.disconnected', {
            channelId: LOUNGE,
            reason: 'channel_deleted'
        })
        expect(deleted.states.change).not.toHaveBeenCalled()
    })

    it('forgets the event when LiveKit cannot put such a person out, so it is sent again', async () => {
        const { run, media, receipts } = setup(joined(), null, EVERYONE_DEFAULT_PERMISSIONS & ~Permission.CONNECT)
        media.removeParticipant.mockRejectedValue(new Error('unreachable'))

        await expect(run()).rejects.toThrow('unreachable')
        expect(receipts.forget).toHaveBeenCalledWith('EV_1')
    })

    it('refuses one not signed by LiveKit, reading nothing from it', async () => {
        const { run, receipts, states } = setup(new MediaEventRejectedError('sha256 checksum of body does not match'))

        await expect(run()).rejects.toBeInstanceOf(MediaEventRejectedError)
        expect(receipts.firstSight).not.toHaveBeenCalled()
        expect(states.change).not.toHaveBeenCalled()
    })

    it('leaves alone an event of another kind, or about a room that is no voice room', async () => {
        for (const event of [{ id: 'EV_2', kind: 'other' } as MediaEvent, joined({ room: `call:${LOUNGE}` })]) {
            const { run, receipts, states } = setup(event)
            await run()
            expect(receipts.firstSight).not.toHaveBeenCalled()
            expect(states.change).not.toHaveBeenCalled()
        }
    })

    it('puts someone who joined in the room and tells it', async () => {
        const { run, events } = setup(joined())

        await run()

        expect(events.publish.mock.calls).toEqual([[new VoiceStateChangedEvent(LOUNGE, 'an', 'joined', at(10))]])
    })

    it('takes an event sent again once', async () => {
        const { run, receipts, states } = setup(joined())
        receipts.firstSight.mockResolvedValue(false)

        await run()

        expect(states.change).not.toHaveBeenCalled()
    })

    it('ignores the late participant_joined of an older connection', async () => {
        const { run, events } = setup(
            joined({ participantSid: 'PA_old', joinedAt: at(0) }),
            row({ participantSid: 'PA_new', joinedAt: at(10) })
        )

        await run()

        expect(events.publish).not.toHaveBeenCalled()
    })

    it('ignores the participant_left of the connection a reload replaced', async () => {
        const { run, events } = setup(
            joined({ kind: 'left', participantSid: 'PA_old' }),
            row({ participantSid: 'PA_new' })
        )

        await run()

        expect(events.publish).not.toHaveBeenCalled()
    })

    it('takes someone out of the room when their connection leaves', async () => {
        const { run, events } = setup(joined({ kind: 'left', participantSid: 'PA_old' }), row())

        await run()

        expect(events.publish.mock.calls).toEqual([[new VoiceStateChangedEvent(LOUNGE, 'an', 'left', at(0))]])
    })

    it('puts someone who joined a room while still in another out of the other (one connection per account)', async () => {
        const { run, media, events } = setup(joined(), row({ channelId: STUDY }))

        await run()

        expect(events.publish.mock.calls).toEqual([
            [new VoiceStateChangedEvent(STUDY, 'an', 'left', at(0))],
            [new VoiceStateChangedEvent(LOUNGE, 'an', 'joined', at(10))]
        ])
        expect(media.removeParticipant).toHaveBeenCalledWith(`voice:${STUDY}`, 'an')
    })

    it('forgets the event when writing failed, so LiveKit sending it again is taken', async () => {
        const { run, receipts, states } = setup(joined())
        states.change.mockRejectedValue(new Error('database down'))

        await expect(run()).rejects.toThrow('database down')
        expect(receipts.forget).toHaveBeenCalledWith('EV_1')
    })

    describe('screens shared (track_published / track_unpublished of screen_share, D-101)', () => {
        it('marks the person sharing, and tells the room', async () => {
            const { run, states, events } = setup(share(), row())

            await run()

            expect(states.change).toHaveBeenCalledWith('an', expect.any(Function))
            expect(events.publish.mock.calls).toEqual([[new VoiceStateChangedEvent(LOUNGE, 'an', 'updated', at(0))]])
        })

        it('unmarks them when the screen stops', async () => {
            const { run, events } = setup(share({ kind: 'share_stopped' }), row({ screenSharing: true }))

            await run()

            expect(events.publish.mock.calls).toEqual([[new VoiceStateChangedEvent(LOUNGE, 'an', 'updated', at(0))]])
        })

        it('stops a second screen in the room: its track muted, its person told who shares (D-101)', async () => {
            const { run, states, media, publisher, events, receipts } = setup(share(), row())
            states.change.mockRejectedValue(new ScreenAlreadySharedError(LOUNGE, 'binh'))

            await run()

            expect(media.muteTrack).toHaveBeenCalledWith(`voice:${LOUNGE}`, 'an', 'TR_screen')
            expect(publisher.toUser).toHaveBeenCalledWith('an', 'voice.share_rejected', {
                channelId: LOUNGE,
                userId: 'binh'
            })
            expect(events.publish).not.toHaveBeenCalled()
            expect(receipts.forget).not.toHaveBeenCalled()
        })

        it('forgets the event when LiveKit cannot mute the second screen, telling nobody yet', async () => {
            const { run, states, media, publisher, receipts } = setup(share(), row())
            states.change.mockRejectedValue(new ScreenAlreadySharedError(LOUNGE, 'binh'))
            media.muteTrack.mockRejectedValue(new Error('unreachable'))

            await expect(run()).rejects.toThrow('unreachable')
            expect(publisher.toUser).not.toHaveBeenCalled()
            expect(receipts.forget).toHaveBeenCalledWith('EV_S')
        })

        it('changes nothing for the screen of a connection a reload replaced', async () => {
            const { run, events } = setup(
                share({ kind: 'share_stopped' }),
                row({ participantSid: 'PA_new', screenSharing: true })
            )

            await run()

            expect(events.publish).not.toHaveBeenCalled()
        })
    })
})
