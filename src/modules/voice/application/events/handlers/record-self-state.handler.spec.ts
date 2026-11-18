import { EventBus } from '@nestjs/cqrs'
import { VoiceSelfStateSignalledEvent } from '@/modules/realtime'
import { VoiceState, VoiceStateRepositoryPort, VoiceWrite } from '../../../domain'
import { VoiceStateChangedEvent } from '../voice-state-changed.event'
import { RecordSelfStateHandler } from './record-self-state.handler'

const LOUNGE = '0190a000-0000-7000-8000-00000000000a'
const JOINED = new Date('2026-11-18T10:00:00Z')
const row: VoiceState = {
    userId: 'an',
    channelId: LOUNGE,
    participantSid: 'PA_1',
    joinedAt: JOINED,
    micOn: false,
    cameraOn: false,
    screenSharing: false,
    modMuted: false
}

describe("A tab's microphone and camera (D-206)", () => {
    const setup = (current: VoiceState | null) => {
        const states = {
            change: jest.fn(async (_userId: string, decide: (state: VoiceState | null) => VoiceWrite | null) => {
                const write = decide(current)
                return write?.kind === 'flags' && current
                    ? { before: current, after: { ...current, ...write.flags } }
                    : null
            })
        }
        const events = { publish: jest.fn() }
        const handler = new RecordSelfStateHandler(
            states as unknown as VoiceStateRepositoryPort,
            events as unknown as EventBus
        )
        return { handler, events }
    }

    it('are written on the row and told to the room', async () => {
        const { handler, events } = setup(row)

        await handler.handle(new VoiceSelfStateSignalledEvent('an', true, false))

        expect(events.publish.mock.calls).toEqual([[new VoiceStateChangedEvent(LOUNGE, 'an', 'updated', JOINED)]])
    })

    it('change nothing for someone in no room, or when nothing changed', async () => {
        for (const [current, mic] of [
            [null, true],
            [row, false]
        ] as const) {
            const { handler, events } = setup(current)
            await handler.handle(new VoiceSelfStateSignalledEvent('an', mic, false))
            expect(events.publish).not.toHaveBeenCalled()
        }
    })
})
