import { ReminderMark } from '../../../domain'

/*
 * A task's due-date reminders (REQ-TASK-04, ARCHITECTURE 7): set by the
 * handlers after each write (events/handlers/schedule-*), sent by the tasks
 * queue at their time through this command.
 */

/** Send the reminder of `mark` for a task due at `dueAt`, if that still holds: run by the tasks queue. */
export class SendTaskReminderCommand {
    constructor(
        readonly taskId: string,
        readonly mark: ReminderMark,
        readonly dueAt: Date
    ) {}
}
