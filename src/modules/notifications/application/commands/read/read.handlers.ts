import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { NotificationsReadEvent } from '../../events/notifications-read.event'
import { Inbox } from '../../services/inbox'
import { MarkNotificationsReadCommand, ReadChannelItemsCommand } from './read.commands'

/**
 * A channel read up to a message, its ReadState moved on (D-188): the
 * person's mention and reply items there up to it are read, on every tab
 * (`notification.read`). Nothing to mark, nothing said.
 */
@CommandHandler(ReadChannelItemsCommand)
export class ReadChannelItemsHandler extends Inbox implements ICommandHandler<ReadChannelItemsCommand> {
    async execute({ userId, channelId, messageId }: ReadChannelItemsCommand): Promise<void> {
        const now = new Date()
        const ids = await this.notifications.markReadUpTo(userId, channelId, messageId, now)
        if (ids.length === 0) return
        this.eventBus.publish(new NotificationsReadEvent(userId, ids, null, await this.unreadCountOf(userId, now)))
    }
}

/**
 * Read in the inbox (REQ-NOTIF-02): the items named, or "mark all" up to the
 * newest one shown, so one arriving meanwhile stays unread. Ids not the
 * person's are left alone. The channels' read state does not move (D-99).
 */
@CommandHandler(MarkNotificationsReadCommand)
export class MarkNotificationsReadHandler extends Inbox implements ICommandHandler<MarkNotificationsReadCommand> {
    async execute({ userId, target }: MarkNotificationsReadCommand): Promise<{ unreadCount: number }> {
        const now = new Date()
        if ('ids' in target) {
            const marked = await this.notifications.markRead(userId, target.ids, now)
            const unreadCount = await this.unreadCountOf(userId, now)
            if (marked.length > 0) this.eventBus.publish(new NotificationsReadEvent(userId, marked, null, unreadCount))
            return { unreadCount }
        }
        const marked = await this.notifications.markAllRead(userId, target.beforeId, now)
        const unreadCount = await this.unreadCountOf(userId, now)
        if (marked > 0) this.eventBus.publish(new NotificationsReadEvent(userId, null, target.beforeId, unreadCount))
        return { unreadCount }
    }
}

export const READ_COMMAND_HANDLERS = [ReadChannelItemsHandler, MarkNotificationsReadHandler]
