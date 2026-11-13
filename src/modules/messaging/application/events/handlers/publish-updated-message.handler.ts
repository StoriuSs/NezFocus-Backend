import { Inject } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { EVENT_PUBLISHER, EventPublisherPort } from '@/modules/realtime'
import { MessageUpdatedEvent } from '../message-updated.event'

/**
 * `message.updated` to every socket that may view the channel (SRS 5.2): the
 * message as it now is, which each client swaps in, the reply lines quoting
 * it included.
 */
@EventsHandler(MessageUpdatedEvent)
export class PublishUpdatedMessageHandler implements IEventHandler<MessageUpdatedEvent> {
    constructor(@Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort) {}

    handle({ message }: MessageUpdatedEvent): void {
        this.publisher.toChannel(message.channelId, 'message.updated', { message })
    }
}
