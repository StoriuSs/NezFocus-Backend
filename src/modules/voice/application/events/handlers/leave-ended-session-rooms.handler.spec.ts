import { Logger } from '@nestjs/common'
import { EventBus } from '@nestjs/cqrs'
import { SessionsEndedEvent } from '@/modules/auth'
import { VoiceState, VoiceStateRepositoryPort, VoiceWrite } from '../../../domain'
import { MediaRoomsPort } from '../../ports'
import { LeaveEndedSessionRoomsHandler } from './leave-ended-session-rooms.handler'

const LOUNGE = '0190a000-0000-7000-8000-00000000000a'
const row = (userId: string, sessionId: string | null): VoiceState => ({
    userId,
    channelId: LOUNGE,
    participantSid: `PA_${userId}`,
    joinedAt: new Date('2026-11-20T10:00:00Z'),
    sessionId,
    micOn: true,
    cameraOn: false,
    screenSharing: false,
    modMuted: false
})

function setup(rows: VoiceState[]) {
    const media = { removeConnection: jest.fn().mockResolvedValue(true), removeParticipant: jest.fn() }
    const writes: Array<[string, VoiceWrite]> = []
    const states = {
        ofSessions: jest.fn(async (ids: string[]) =>
            rows.filter((one) => one.sessionId && ids.includes(one.sessionId))
        ),
        change: jest.fn(async (userId: string, decide: (state: VoiceState | null) => VoiceWrite | null) => {
            const current = rows.find((one) => one.userId === userId) ?? null
            const write = decide(current)
            if (write) writes.push([userId, write])
            return write ? { before: current, after: null } : null
        })
    }
    const events = { publish: jest.fn() }
    const handler = new LeaveEndedSessionRoomsHandler(
        media as unknown as MediaRoomsPort,
        states as unknown as VoiceStateRepositoryPort,
        events as unknown as EventBus
    )
    return { handler, media, writes, states, events }
}

describe('Sign-in sessions ending while their connections are in voice rooms (D-214)', () => {
    beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined))
    afterEach(() => jest.restoreAllMocks())

    it('puts out the connections those sessions made, and only those, and moves the list', async () => {
        const { handler, media, writes, events } = setup([
            row('an', 's-an-laptop'),
            row('binh', 's-binh'),
            row('chi', null)
        ])

        await handler.handle(new SessionsEndedEvent(['s-an-laptop', 's-gone']))

        // That connection, not whatever LiveKit holds for An now (another sign-in may have joined since).
        expect(media.removeConnection.mock.calls).toEqual([[`voice:${LOUNGE}`, 'an', 'PA_an']])
        expect(media.removeParticipant).not.toHaveBeenCalled()
        expect(writes).toEqual([['an', { kind: 'remove' }]])
        expect(events.publish).toHaveBeenCalledTimes(1)
    })

    it('in no room, changes nothing', async () => {
        const { handler, media, states } = setup([row('binh', 's-binh')])

        await handler.handle(new SessionsEndedEvent(['s-an-phone']))

        expect(states.ofSessions).toHaveBeenCalledWith(['s-an-phone'])
        expect(media.removeConnection).not.toHaveBeenCalled()
    })

    it('keeps going past a room LiveKit could not be asked about', async () => {
        const { handler, media, writes } = setup([row('an', 's-an'), row('binh', 's-binh')])
        media.removeConnection.mockRejectedValueOnce(new Error('unavailable'))

        await handler.handle(new SessionsEndedEvent(['s-an', 's-binh']))

        expect(media.removeConnection).toHaveBeenCalledTimes(2)
        expect(writes).toEqual([['binh', { kind: 'remove' }]])
    })

    it('gives up quietly when the rows cannot be read: the tabs of those sessions sign out and leave', async () => {
        const { handler, media, states } = setup([row('an', 's-an')])
        states.ofSessions.mockRejectedValueOnce(new Error('connection lost'))

        await expect(handler.handle(new SessionsEndedEvent(['s-an']))).resolves.toBeUndefined()

        expect(media.removeConnection).not.toHaveBeenCalled()
        expect(Logger.prototype.warn).toHaveBeenCalled()
    })
})
