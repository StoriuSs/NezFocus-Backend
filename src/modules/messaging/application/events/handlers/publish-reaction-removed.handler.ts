import { Inject } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { EVENT_PUBLISHER, EventPublisherPort } from '@/modules/realtime'
import { ReactionRemovedEvent } from '../reaction-removed.event'

/** `reaction.removed` to every socket that may view the channel (SRS 5.2), shaped like `reaction.added`. */
@EventsHandler(ReactionRemovedEvent)
export class PublishReactionRemovedHandler implements IEventHandler<ReactionRemovedEvent> {
    constructor(@Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort) {}

    handle({ channelId, messageId, emoji, userId }: ReactionRemovedEvent): void {
        this.publisher.toChannel(channelId, 'reaction.removed', { channelId, messageId, emoji, userId })
    }
}
