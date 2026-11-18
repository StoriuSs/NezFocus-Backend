import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import { VoiceSelfStateSignalledEvent } from '../../events/voice-self-state-signalled.event'
import { ReportVoiceStateCommand } from './report-voice-state.command'

/**
 * Hands a tab's microphone and camera on to the module it belongs to
 * (D-206): realtime only received it. Voice hears VoiceSelfStateSignalledEvent,
 * writes it on the person's row if they are in a room, and tells the room.
 */
@CommandHandler(ReportVoiceStateCommand)
export class ReportVoiceStateHandler implements ICommandHandler<ReportVoiceStateCommand> {
    constructor(private readonly eventBus: EventBus) {}

    execute({ userId, micOn, cameraOn }: ReportVoiceStateCommand): Promise<void> {
        this.eventBus.publish(new VoiceSelfStateSignalledEvent(userId, micOn, cameraOn))
        return Promise.resolve()
    }
}
