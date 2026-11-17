/*
 * The jobs on the `tasks` queue: their names and what each carries. One
 * contract for both sides: BullMqTaskJobs adds them, TasksJobsConsumer runs
 * them. Job data is JSON. A job already in Redis was written with an earlier
 * version of these, so a field added later stays optional.
 */

export const TASKS_JOBS = {
    /** A member who left a server, taken off its tasks (D-195). */
    UNASSIGN_LEFT_MEMBER: 'unassign-left-member'
} as const

export interface UnassignLeftMemberJob {
    serverId: string
    userId: string
}
