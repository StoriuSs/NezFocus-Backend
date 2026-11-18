import { Inject } from '@nestjs/common'
import { CommandBus, CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { PostTaskDueCommand } from '@/modules/messaging'
import { NOTIFIER, NotifierPort } from '@/modules/notifications'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { reminderHolds, reminderRecipients, TASK_REPOSITORY, TaskRepositoryPort } from '../../../domain'
import { boardReach } from '../../services/board-access'
import { SendTaskReminderCommand } from './reminder.commands'

/**
 * A task's reminder at its time (REQ-TASK-04, MSG-08): the task is read
 * again (ARCHITECTURE 7), and nothing is sent for a task deleted, done, due
 * at another time now, on a board turned off, or a reminder missed (run
 * after the next mark or the due date, D-95). Then an item in the inbox
 * of each person on it who views the channel, or of its creator when none
 * does; then "Còn 24 giờ tới hạn: …" in the channel, naming them in plain
 * words (D-95), or its creator. Both are written once per mark and due
 * date, so a job run again after a failure adds neither twice.
 *
 * @returns whether the reminder was sent
 */
@CommandHandler(SendTaskReminderCommand)
export class SendTaskReminderHandler implements ICommandHandler<SendTaskReminderCommand> {
    constructor(
        @Inject(TASK_REPOSITORY) private readonly tasks: TaskRepositoryPort,
        @Inject(PERMISSION_CHECKER) private readonly checker: PermissionCheckerPort,
        @Inject(NOTIFIER) private readonly notifier: NotifierPort,
        private readonly commandBus: CommandBus
    ) {}

    async execute({ taskId, mark, dueAt }: SendTaskReminderCommand): Promise<boolean> {
        const now = new Date()
        const task = await this.tasks.find(taskId)
        if (!task || !reminderHolds(task, mark, dueAt, now)) return false
        const assigneeIds = task.assignees.map((assignee) => assignee.person.id)
        const board = await boardReach(this.checker, task, [...assigneeIds, task.creator.id], now)
        if (!board.on) return false

        const { serverId, channelId, title } = task
        const recipients = reminderRecipients(assigneeIds, task.creator.id, board.viewerIds)
        if (recipients.length > 0) {
            await this.notifier.taskReminder({ serverId, channelId, taskId, title, dueAt }, mark, recipients)
        }
        await this.commandBus.execute(
            new PostTaskDueCommand(serverId, channelId, {
                taskId,
                title,
                reminder: mark,
                dueAt: dueAt.toISOString(),
                userIds: recipients.length > 0 ? recipients : [task.creator.id]
            })
        )
        return true
    }
}

export const REMINDER_COMMAND_HANDLERS = [SendTaskReminderHandler]
