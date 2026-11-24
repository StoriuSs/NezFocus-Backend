import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { taskItemRecipients } from '../../../domain'
import { NotificationsCreatedEvent } from '../../events/notifications-created.event'
import { NotificationsDeletedEvent } from '../../events/notifications-deleted.event'
import { Inbox } from '../../services/inbox'
import { notificationViews } from '../../services/notification-views'
import { AddTaskItemsCommand, ForgetTaskItemsCommand } from './task-item.commands'

/**
 * A task item for each person named (D-98, D-95, REQ-TASK-04), unread, with
 * the task's title and due date as they are now, which the item keeps. Never
 * for the one who acted (D-185): taking a task on oneself makes no item, a
 * creator who left their own task hears nothing; nor does anyone who
 * blocked the one who acted (D-242). A reminder is written once
 * per mark and due date, so its job run again writes none twice. A task
 * deleted meanwhile gets none, and no one hears of them.
 */
@CommandHandler(AddTaskItemsCommand)
export class AddTaskItemsHandler extends Inbox implements ICommandHandler<AddTaskItemsCommand> {
    async execute({ draft, userIds }: AddTaskItemsCommand): Promise<void> {
        let people = await this.notBlocking(draft.actorId, taskItemRecipients(draft.actorId, userIds))
        const { reminder, dueAt } = draft.facts
        if (draft.type === 'task_reminder' && reminder && dueAt && people.length > 0) {
            const reminded = new Set(await this.notifications.remindedAlready(draft.place, reminder, dueAt, people))
            people = people.filter((userId) => !reminded.has(userId))
        }
        if (people.length === 0) return
        const added = await this.notifications.addTaskItems(draft, people, new Date())
        if (added.length === 0) return
        const owners = new Map(added.map((record) => [record.id, record.userId]))
        const views = await notificationViews(this.viewSources, added)
        this.eventBus.publish(
            new NotificationsCreatedEvent(
                views.map((notification) => ({ userId: owners.get(notification.id)!, notification }))
            )
        )
    }
}

/**
 * A task deleted (D-98, D-200): the foreign key took its items in the same
 * transaction, so which were whose is not known any more. Everyone the
 * tasks module names, its creator and all ever put on it, hears that the
 * task's items went, with their unread count now; one who had none sees
 * the same count again.
 */
@CommandHandler(ForgetTaskItemsCommand)
export class ForgetTaskItemsHandler extends Inbox implements ICommandHandler<ForgetTaskItemsCommand> {
    async execute({ taskId, userIds }: ForgetTaskItemsCommand): Promise<void> {
        const people = [...new Set(userIds)]
        if (people.length === 0) return
        const counts = await this.unreadCountsOf(people, new Date())
        this.eventBus.publish(
            new NotificationsDeletedEvent(
                people.map((userId) => ({ userId, ids: [], unreadCount: counts.get(userId)!, taskId }))
            )
        )
    }
}

export const TASK_ITEM_COMMAND_HANDLERS = [AddTaskItemsHandler, ForgetTaskItemsHandler]
