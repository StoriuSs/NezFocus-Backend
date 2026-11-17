import { Inject } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { EVENT_PUBLISHER, EventPublisherPort } from '@/modules/realtime'
import { NotificationsReadEvent } from '../notifications-read.event'

/**
 * `notification.read` to every tab of the person (SRS 5.2, REQ-NOTIF-02):
 * read in the inbox, in the channel or by sending there alike.
 */
@EventsHandler(NotificationsReadEvent)
export class PublishReadNotificationsHandler implements IEventHandler<NotificationsReadEvent> {
    constructor(@Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort) {}

    handle({ userId, ids, beforeId, unreadCount }: NotificationsReadEvent): void {
        this.publisher.toUser(userId, 'notification.read', { ids, beforeId, unreadCount })
    }
}
