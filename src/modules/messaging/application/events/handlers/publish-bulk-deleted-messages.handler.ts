import { Inject } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { EVENT_PUBLISHER, EventPublisherPort } from '@/modules/realtime'
import { MessagesBulkDeletedEvent } from '../messages-bulk-deleted.event'

/**
 * `message.bulk_deleted` to every socket that may view the channel (SRS 5.2,
 * D-181): which messages, one event for a batch, so clients drop each as for
 * `message.deleted`.
 */
@EventsHandler(MessagesBulkDeletedEvent)
export class PublishBulkDeletedMessagesHandler implements IEventHandler<MessagesBulkDeletedEvent> {
    constructor(@Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort) {}

    handle({ channelId, ids }: MessagesBulkDeletedEvent): void {
        this.publisher.toChannel(channelId, 'message.bulk_deleted', { channelId, ids })
    }
}
