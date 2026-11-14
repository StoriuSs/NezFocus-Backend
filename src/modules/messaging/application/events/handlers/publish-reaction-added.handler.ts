import { Inject } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { EVENT_PUBLISHER, EventPublisherPort } from '@/modules/realtime'
import { ReactionAddedEvent } from '../reaction-added.event'

/**
 * `reaction.added` to every socket that may view the channel (SRS 5.2): who
 * gave which emoji, so each client counts it and knows whether it was itself.
 */
@EventsHandler(ReactionAddedEvent)
export class PublishReactionAddedHandler implements IEventHandler<ReactionAddedEvent> {
    constructor(@Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort) {}

    handle({ channelId, messageId, emoji, userId }: ReactionAddedEvent): void {
        this.publisher.toChannel(channelId, 'reaction.added', { channelId, messageId, emoji, userId })
    }
}
