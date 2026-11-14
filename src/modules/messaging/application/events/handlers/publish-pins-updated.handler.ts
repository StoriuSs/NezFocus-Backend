import { Inject } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { EVENT_PUBLISHER, EventPublisherPort } from '@/modules/realtime'
import { PinsUpdatedEvent } from '../pins-updated.event'

/**
 * `pins.updated` to every socket that may view the channel (SRS 5.2): which
 * message, pinned or not, so clients mark it and read the pins panel again.
 */
@EventsHandler(PinsUpdatedEvent)
export class PublishPinsUpdatedHandler implements IEventHandler<PinsUpdatedEvent> {
    constructor(@Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort) {}

    handle({ channelId, messageId, pinned }: PinsUpdatedEvent): void {
        this.publisher.toChannel(channelId, 'pins.updated', { channelId, messageId, pinned })
    }
}
