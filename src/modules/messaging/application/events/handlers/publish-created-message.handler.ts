import { Inject } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { EVENT_PUBLISHER, EventPublisherPort } from '@/modules/realtime'
import { MessageCreatedEvent } from '../message-created.event'

/**
 * `message.created` to every socket that may view the channel (ARCHITECTURE
 * 2.3, D-163), the sender's own tabs included: they match it by nonce. A
 * socket that misses it catches up with `after=<last id>` (ARCHITECTURE 3.4).
 */
@EventsHandler(MessageCreatedEvent)
export class PublishCreatedMessageHandler implements IEventHandler<MessageCreatedEvent> {
    constructor(@Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort) {}

    handle({ message, nonce }: MessageCreatedEvent): void {
        this.publisher.toChannel(message.channelId, 'message.created', { message, nonce })
    }
}

export const MESSAGE_EVENT_HANDLERS = [PublishCreatedMessageHandler]
