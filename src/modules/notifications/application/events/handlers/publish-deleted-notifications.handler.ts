import { Inject } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { EVENT_PUBLISHER, EventPublisherPort } from '@/modules/realtime'
import { NotificationsDeletedEvent } from '../notifications-deleted.event'

/** `notification.deleted` to every tab of each person (SRS 5.2): the items go from their inbox. */
@EventsHandler(NotificationsDeletedEvent)
export class PublishDeletedNotificationsHandler implements IEventHandler<NotificationsDeletedEvent> {
    constructor(@Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort) {}

    handle({ entries }: NotificationsDeletedEvent): void {
        for (const { userId, ids, unreadCount } of entries) {
            this.publisher.toUser(userId, 'notification.deleted', { ids, unreadCount })
        }
    }
}
