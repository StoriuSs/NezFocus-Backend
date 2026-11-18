import { ReminderAt } from '../../domain'

/**
 * Task Jobs Port: the tasks module's work handed to its queue, so it is
 * retried and survives a restart (D-195, NFR-REL-02): a failed event handler
 * is never run again.
 */
export interface TaskJobsPort {
    /** Take a member who left the server off its tasks, soon. Queueing the same leave twice is one job. */
    unassignLeftMemberLater(serverId: string, userId: string, leftAt: Date): Promise<void>

    /**
     * Send each reminder of the task's due date at its time (REQ-TASK-04).
     * Each is named by the task, the mark and the due date (ARCHITECTURE 7),
     * so setting one still waiting again is one job.
     */
    remindLater(taskId: string, dueAt: Date, reminders: ReminderAt[]): Promise<void>

    /**
     * Drop the reminders of the task's due date still waiting: the date
     * moved, or the task is done or deleted. One already running is not
     * stopped: it reads the task again and does nothing.
     */
    cancelReminders(taskId: string, dueAt: Date): Promise<void>
}

export const TASK_JOBS = Symbol('TaskJobsPort')
