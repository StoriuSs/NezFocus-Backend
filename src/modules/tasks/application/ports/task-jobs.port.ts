/**
 * Task Jobs Port: the tasks module's work handed to its queue, so it is
 * retried and survives a restart (D-195): a failed event handler is never
 * run again.
 */
export interface TaskJobsPort {
    /** Take a member who left the server off its tasks, soon. Queueing the same leave twice is one job. */
    unassignLeftMemberLater(serverId: string, userId: string, leftAt: Date): Promise<void>
}

export const TASK_JOBS = Symbol('TaskJobsPort')
