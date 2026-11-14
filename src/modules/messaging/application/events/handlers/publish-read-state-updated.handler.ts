import { Inject } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { EVENT_PUBLISHER, EventPublisherPort } from '@/modules/realtime'
import { ReadStateUpdatedEvent } from '../read-state-updated.event'

/**
 * `read_state.updated` to every socket of the person (SRS 5.2): their other
 * tabs and devices drop the channel's unread and mentions within the
 * 2 seconds of REQ-MSG-09.
 */
@EventsHandler(ReadStateUpdatedEvent)
export class PublishReadStateUpdatedHandler implements IEventHandler<ReadStateUpdatedEvent> {
    constructor(@Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort) {}

    handle({ userId, state }: ReadStateUpdatedEvent): void {
        this.publisher.toUser(userId, 'read_state.updated', state)
    }
}
