import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { Inbox } from '../../services/inbox'
import { NotificationView, notificationViews } from '../../services/notification-views'
import { ListNotificationsQuery } from './inbox.queries'

/** A page of the inbox as `GET /me/notifications` gives it, with the badge's count. */
export interface NotificationList {
    items: NotificationView[]
    unreadCount: number
    hasMore: boolean
}

/**
 * The inbox (REQ-NOTIF-01): the items of channels one views now, newest
 * first, and how many of them are unread, with one condition for both
 * (REQ-NOTIF-03). A page can come short when a message was deleted and its
 * items not yet taken off; `hasMore` still says whether older ones follow.
 */
@QueryHandler(ListNotificationsQuery)
export class ListNotificationsHandler extends Inbox implements IQueryHandler<ListNotificationsQuery> {
    async execute({ userId, beforeId, limit }: ListNotificationsQuery): Promise<NotificationList> {
        const channelIds = await this.channelsOf(userId, new Date())
        const [page, unreadCount] = await Promise.all([
            this.notifications.page(userId, channelIds, beforeId, limit),
            this.notifications.unreadCount(userId, channelIds)
        ])
        return { items: await notificationViews(this.viewSources, page.items), unreadCount, hasMore: page.more }
    }
}

export const INBOX_QUERY_HANDLERS = [ListNotificationsHandler]
