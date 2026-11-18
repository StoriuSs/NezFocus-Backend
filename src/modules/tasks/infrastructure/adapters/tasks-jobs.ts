import { ReminderMark } from '../../domain'

/*
 * The jobs on the `tasks` queue: their names and what each carries. One
 * contract for both sides: BullMqTaskJobs adds them, TasksJobsConsumer runs
 * them. Job data is JSON. A job already in Redis was written with an earlier
 * version of these, so a field added later stays optional.
 */

export const TASKS_JOBS = {
    /** A member who left a server, taken off its tasks (D-195). */
    UNASSIGN_LEFT_MEMBER: 'unassign-left-member',
    /** A task due in 24 or 2 hours, reminded (REQ-TASK-04). */
    SEND_REMINDER: 'send-task-reminder'
} as const

export interface UnassignLeftMemberJob {
    serverId: string
    userId: string
}

/** Only what to read again when it runs (ARCHITECTURE 7): the task, the mark, and the due date it was set for. */
export interface SendTaskReminderJob {
    taskId: string
    mark: ReminderMark
    /** ISO time. */
    dueAt: string
}

export type TasksJob = UnassignLeftMemberJob | SendTaskReminderJob
