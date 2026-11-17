import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { isKept, messageRecipients, planMessageItems, RemovedNotification } from '../../../domain'
import { NotificationsCreatedEvent } from '../../events/notifications-created.event'
import { NotificationsDeletedEvent } from '../../events/notifications-deleted.event'
import { Inbox } from '../../services/inbox'
import { notificationViews } from '../../services/notification-views'
import { RemoveMessageItemsCommand, SyncMessageItemsCommand } from './item.commands'

/** What item handlers share: telling people of the items they lost. */
abstract class ChangeItems extends Inbox {
    protected async publishRemoved(removed: RemovedNotification[], now: Date): Promise<void> {
        if (removed.length === 0) return
        this.eventBus.publish(new NotificationsDeletedEvent(await this.removedEntries(removed, now)))
    }
}

/**
 * A message sent or edited (REQ-NOTIF-01, D-188): one item for each person it
 * mentions or answers now, by the strongest reason, never its author; those
 * no longer mentioned lose theirs; a message older than 90 days gets no new
 * ones. Those who had read past it get theirs read (D-199). Run again for
 * the same message, it writes nothing twice. A message deleted while its
 * items were written loses them again here, or the badge would count items
 * the inbox never shows (REQ-NOTIF-03).
 */
@CommandHandler(SyncMessageItemsCommand)
export class SyncMessageItemsHandler extends ChangeItems implements ICommandHandler<SyncMessageItemsCommand> {
    async execute({ notice }: SyncMessageItemsCommand): Promise<void> {
        const now = new Date()
        const plan = planMessageItems(
            await this.notifications.heldForMessage(notice.channelId, notice.messageId),
            messageRecipients(notice.actorId, notice.sources),
            isKept(notice.sentAt, now)
        )
        if (plan.add.length === 0 && plan.remove.length === 0 && plan.change.length === 0) return
        const { added, removed } = await this.notifications.applyMessagePlan(
            notice,
            plan,
            new Set(notice.readerIds),
            now
        )
        const views = added.length > 0 ? await notificationViews(this.viewSources, added) : []
        if (views.length > 0) {
            const owners = new Map(added.map((record) => [record.id, record.userId]))
            this.eventBus.publish(
                new NotificationsCreatedEvent(
                    views.map((notification) => ({ userId: owners.get(notification.id)!, notification }))
                )
            )
        } else if (added.length > 0) {
            // Deleted while its items were written: its delete found none to take off, so take them off now.
            removed.push(...(await this.notifications.removeForMessages(notice.channelId, [notice.messageId])))
        }
        await this.publishRemoved(removed, now)
    }
}

/** Messages deleted, by hand or with a ban (REQ-NOTIF-03, D-181): their items go, and the badges count again. */
@CommandHandler(RemoveMessageItemsCommand)
export class RemoveMessageItemsHandler extends ChangeItems implements ICommandHandler<RemoveMessageItemsCommand> {
    async execute({ channelId, messageIds }: RemoveMessageItemsCommand): Promise<void> {
        await this.publishRemoved(await this.notifications.removeForMessages(channelId, messageIds), new Date())
    }
}

export const ITEM_COMMAND_HANDLERS = [SyncMessageItemsHandler, RemoveMessageItemsHandler]
