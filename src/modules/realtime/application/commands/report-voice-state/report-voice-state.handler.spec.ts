import { EventBus } from '@nestjs/cqrs'
import { VoiceSelfStateSignalledEvent } from '../../events/voice-self-state-signalled.event'
import { ReportVoiceStateCommand } from './report-voice-state.command'
import { ReportVoiceStateHandler } from './report-voice-state.handler'

describe("A tab's microphone and camera in a voice room (D-206)", () => {
    it('are handed on to voice as they came: who is in which room is its own', async () => {
        const events = { publish: jest.fn() }
        await new ReportVoiceStateHandler(events as unknown as EventBus).execute(
            new ReportVoiceStateCommand('an', true, false)
        )
        expect(events.publish).toHaveBeenCalledWith(new VoiceSelfStateSignalledEvent('an', true, false))
    })
})
