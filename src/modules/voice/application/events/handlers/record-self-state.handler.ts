import { Inject } from '@nestjs/common'
import { EventBus, EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { VoiceSelfStateSignalledEvent } from '@/modules/realtime'
import { selfStateWrite, VOICE_STATE_REPOSITORY, VoiceStateRepositoryPort } from '../../../domain'
import { changeEvents } from '../../services/voice-changes'

/**
 * The microphone and camera a tab says it has (D-206), written on its
 * person's row and told to the room. Only icons: the people in the room see
 * the tracks themselves. Nothing when they are in no room, or nothing
 * changed (a tab repeating itself costs no event).
 */
@EventsHandler(VoiceSelfStateSignalledEvent)
export class RecordSelfStateHandler implements IEventHandler<VoiceSelfStateSignalledEvent> {
    constructor(
        @Inject(VOICE_STATE_REPOSITORY) private readonly states: VoiceStateRepositoryPort,
        private readonly events: EventBus
    ) {}

    async handle({ userId, micOn, cameraOn }: VoiceSelfStateSignalledEvent): Promise<void> {
        const result = await this.states.change(userId, (current) => selfStateWrite(current, micOn, cameraOn))
        for (const event of changeEvents(result)) this.events.publish(event)
    }
}
