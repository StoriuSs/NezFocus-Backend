import { Inject, Logger } from '@nestjs/common'
import { EventBus, EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { CALL_MEDIA, CallMediaChangedEvent, type CallMediaPort } from '@/modules/voice'
import { CALL_REPOSITORY, CallRepositoryPort } from '../../../domain'
import { CALL_JOBS, CallJobsPort } from '../../ports'
import { MediaSources, recordMedia } from '../../services/call-room'

/**
 * Someone came into a call's room or went, as voice tells LiveKit's
 * webhook (D-239): their row written, the call's media job set again, or
 * the connection put out when it should not be there (the call not active,
 * someone not of it; D-242). Not retried (adding-a-module.md › Events): the
 * sweep reads the room's people every minute (D-246).
 */
@EventsHandler(CallMediaChangedEvent)
export class RecordCallMediaHandler implements IEventHandler<CallMediaChangedEvent> {
    private readonly logger = new Logger(RecordCallMediaHandler.name)
    private readonly sources: MediaSources

    constructor(
        @Inject(CALL_REPOSITORY) calls: CallRepositoryPort,
        @Inject(CALL_JOBS) jobs: CallJobsPort,
        @Inject(CALL_MEDIA) media: CallMediaPort,
        events: EventBus
    ) {
        this.sources = { calls, jobs, events, media }
    }

    async handle({ callId, change }: CallMediaChangedEvent): Promise<void> {
        try {
            await recordMedia(this.sources, callId, change)
        } catch (error) {
            this.logger.warn(`The ${change.kind} of ${change.userId} in call ${callId} not taken: ${String(error)}`)
        }
    }
}
