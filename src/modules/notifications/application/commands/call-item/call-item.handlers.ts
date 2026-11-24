import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { NotificationsCreatedEvent } from '../../events/notifications-created.event'
import { Inbox } from '../../services/inbox'
import { notificationViews } from '../../services/notification-views'
import { AddMissedCallItemCommand } from './call-item.commands'

/**
 * A missed call item for its callee (REQ-SOCIAL-06), unread, read with the
 * DM past its message (D-242). None for someone who blocked the caller
 * (D-185), and none when the DM or an account is gone for good meanwhile.
 */
@CommandHandler(AddMissedCallItemCommand)
export class AddMissedCallItemHandler extends Inbox implements ICommandHandler<AddMissedCallItemCommand> {
    async execute({ userId, actorId, channelId, messageId }: AddMissedCallItemCommand): Promise<void> {
        if ((await this.notBlocking(actorId, [userId])).length === 0) return
        const record = await this.notifications.addMissedCallItem(userId, actorId, channelId, messageId, new Date())
        if (!record) return
        const [notification] = await notificationViews(this.viewSources, [record])
        this.eventBus.publish(new NotificationsCreatedEvent([{ userId, notification: notification! }]))
    }
}

export const CALL_ITEM_COMMAND_HANDLERS = [AddMissedCallItemHandler]
