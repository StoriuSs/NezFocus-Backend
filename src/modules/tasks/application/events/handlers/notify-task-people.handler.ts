import { Inject, Logger } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { NOTIFIER, NotifierPort, TaskNotice } from '@/modules/notifications'
import { TaskView } from '../../services/task-views'
import { TaskCreatedEvent } from '../task-created.event'
import { TaskUpdatedEvent } from '../task-updated.event'

const noticeOf = ({ id, serverId, channelId, title, dueAt }: TaskView): TaskNotice => ({
    serverId,
    channelId,
    taskId: id,
    title,
    dueAt
})

/**
 * The inbox items a task's people get (D-98, D-95), through NOTIFIER after
 * the write is saved:
 * - people put on it by someone else, when it is made or later ("Minh giao
 *   cho bạn: …"); taking it on oneself makes none;
 * - its creator, when its last person took themselves off or left the
 *   server ("Không còn ai làm: …"), unless that was the creator or the task
 *   is done. Someone taken off by the creator or MANAGE_TASKS tells no one:
 *   they did it.
 *
 * A failure is logged: the task is saved, and an item is not worth failing
 * it for (as D-173).
 */
@EventsHandler(TaskCreatedEvent, TaskUpdatedEvent)
export class NotifyTaskPeopleHandler implements IEventHandler<TaskCreatedEvent | TaskUpdatedEvent> {
    private readonly logger = new Logger(NotifyTaskPeopleHandler.name)

    constructor(@Inject(NOTIFIER) private readonly notifier: NotifierPort) {}

    async handle(event: TaskCreatedEvent | TaskUpdatedEvent): Promise<void> {
        const { task } = event
        try {
            if (event instanceof TaskCreatedEvent) {
                const people = task.assignees.map((assignee) => assignee.id)
                if (people.length > 0) await this.notifier.taskAssigned(noticeOf(task), task.creator.id, people)
                return
            }
            const { actorId, added, removed } = event.change
            if (actorId && added.length > 0) await this.notifier.taskAssigned(noticeOf(task), actorId, added)
            const [leaver] = removed
            // A task done needs no one to do it: nothing to tell (asked 18/11/2026).
            const leftAlone =
                task.status !== 'done' && task.assignees.length === 0 && removed.length === 1 && leaver !== undefined
            if (leftAlone && (actorId === null || actorId === leaver)) {
                await this.notifier.taskUnassigned(
                    noticeOf(task),
                    task.creator.id,
                    leaver,
                    actorId === null ? 'left_server' : 'withdrew'
                )
            }
        } catch (error) {
            this.logger.error(`Could not write the inbox items of task ${task.id}`, error)
        }
    }
}
