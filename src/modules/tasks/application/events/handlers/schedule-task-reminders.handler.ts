import { Inject, Logger } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { futureMarks, reminderChange, TASK_REPOSITORY, TaskRepositoryPort } from '../../../domain'
import { TASK_JOBS, TaskJobsPort } from '../../ports'
import { TaskCreatedEvent } from '../task-created.event'
import { TaskDeletedEvent } from '../task-deleted.event'
import { TaskUpdatedEvent } from '../task-updated.event'

type TaskWritten = TaskCreatedEvent | TaskUpdatedEvent | TaskDeletedEvent

/**
 * A task's due-date reminders after each write (REQ-TASK-04, ARCHITECTURE
 * 7): made with a due date, its due date moved, or reopened: the marks still
 * ahead are set (D-95); its due date moved, done or deleted: those of the
 * old due date still waiting are dropped, unless the task has that due date
 * again by now. A job left behind does no harm, as it reads the task again.
 * A failure is logged and thrown (D-195): the write is saved, and those are
 * the reminders to set by hand.
 */
@EventsHandler(TaskCreatedEvent, TaskUpdatedEvent, TaskDeletedEvent)
export class ScheduleTaskRemindersHandler implements IEventHandler<TaskWritten> {
    private readonly logger = new Logger(ScheduleTaskRemindersHandler.name)

    constructor(
        @Inject(TASK_JOBS) private readonly jobs: TaskJobsPort,
        @Inject(TASK_REPOSITORY) private readonly tasks: TaskRepositoryPort
    ) {}

    async handle(event: TaskWritten): Promise<void> {
        const taskId = event instanceof TaskDeletedEvent ? event.taskId : event.task.id
        const { cancel, schedule } =
            event instanceof TaskDeletedEvent
                ? reminderChange(event.before, null)
                : reminderChange(event instanceof TaskUpdatedEvent ? event.change.before : null, event.task)
        try {
            if (cancel && !(await this.dueAgain(taskId, cancel))) await this.jobs.cancelReminders(taskId, cancel)
            if (schedule) await this.jobs.remindLater(taskId, schedule, futureMarks(schedule, new Date()))
        } catch (error) {
            this.logger.error(`The reminders of task ${taskId} not set: ${String(error)}`)
            throw error
        }
    }

    /**
     * Whether the task, as it is now, is open and due at `dueAt` again: two
     * writes at once may be heard out of order (D to E, then back to D),
     * and dropping D's reminders then would leave the task with none. A job
     * left behind does no harm; one missing does.
     */
    private async dueAgain(taskId: string, dueAt: Date): Promise<boolean> {
        const task = await this.tasks.find(taskId)
        return task !== null && task.status !== 'done' && task.dueAt?.getTime() === dueAt.getTime()
    }
}
