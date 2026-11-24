import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { NotificationsCreatedEvent } from '../../events/notifications-created.event'
import { NotificationsDeletedEvent } from '../../events/notifications-deleted.event'
import { Inbox } from '../../services/inbox'
import { notificationViews } from '../../services/notification-views'
import { AddFriendItemCommand, RemoveFriendRequestItemsCommand } from './friend-item.commands'

/**
 * A friend item for one person (D-111, D-242), unread: `friend_request`
 * keeps its note, `friend_accepted` none. Never for the one who acted, nor
 * for someone who blocked them (D-185). None when an account is gone for
 * good meanwhile.
 */
@CommandHandler(AddFriendItemCommand)
export class AddFriendItemHandler extends Inbox implements ICommandHandler<AddFriendItemCommand> {
    async execute({ type, userId, actorId, note }: AddFriendItemCommand): Promise<void> {
        if ((await this.notBlocking(actorId, [userId])).length === 0) return
        const record = await this.notifications.addFriendItem(type, userId, actorId, note, new Date())
        if (!record) return
        const [notification] = await notificationViews(this.viewSources, [record])
        this.eventBus.publish(new NotificationsCreatedEvent([{ userId, notification: notification! }]))
    }
}

/** A request closed (NOTIF-03): its item goes, and its owner hears it with their unread count. */
@CommandHandler(RemoveFriendRequestItemsCommand)
export class RemoveFriendRequestItemsHandler extends Inbox implements ICommandHandler<RemoveFriendRequestItemsCommand> {
    async execute({ userId, otherId }: RemoveFriendRequestItemsCommand): Promise<void> {
        const removed = await this.notifications.removeFriendRequests(userId, otherId)
        if (removed.length === 0) return
        this.eventBus.publish(new NotificationsDeletedEvent(await this.removedEntries(removed, new Date())))
    }
}

export const FRIEND_ITEM_COMMAND_HANDLERS = [AddFriendItemHandler, RemoveFriendRequestItemsHandler]
