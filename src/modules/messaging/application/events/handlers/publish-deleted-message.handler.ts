import { Inject } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { EVENT_PUBLISHER, EventPublisherPort } from '@/modules/realtime'
import { MessageDeletedEvent } from '../message-deleted.event'

/**
 * `message.deleted` to every socket that may view the channel (SRS 5.2): only
 * which message, so clients drop it and their reply lines say it was deleted.
 */
@EventsHandler(MessageDeletedEvent)
export class PublishDeletedMessageHandler implements IEventHandler<MessageDeletedEvent> {
    constructor(@Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort) {}

    handle({ messageId, channelId }: MessageDeletedEvent): void {
        this.publisher.toChannel(channelId, 'message.deleted', { id: messageId, channelId })
    }
}
