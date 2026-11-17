import { Inject } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { EVENT_PUBLISHER, EventPublisherPort } from '@/modules/realtime'
import { NotificationsCreatedEvent } from '../notifications-created.event'

/**
 * `notification.created` to every tab of each person (SRS 5.2): the whole
 * item, which goes on top of their inbox; unread, it adds one to the badge.
 */
@EventsHandler(NotificationsCreatedEvent)
export class PublishCreatedNotificationsHandler implements IEventHandler<NotificationsCreatedEvent> {
    constructor(@Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort) {}

    handle({ items }: NotificationsCreatedEvent): void {
        for (const { userId, notification } of items) {
            this.publisher.toUser(userId, 'notification.created', { notification })
        }
    }
}
