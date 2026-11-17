import { NotificationView } from '../services/notification-views'

/** Items written, each for its person (REQ-NOTIF-01): an @everyone message makes one per member reached. */
export class NotificationsCreatedEvent {
    constructor(readonly items: { userId: string; notification: NotificationView }[]) {}
}
