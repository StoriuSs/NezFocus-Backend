/*
 * The jobs on the `messaging` queue: their names and what each carries. One
 * contract for both sides: BullMqMessagePurge adds them,
 * MessagingJobsConsumer runs them. Dates travel as ISO text (job data is
 * JSON). A job already in Redis was written with an earlier version of
 * these, so a field added later stays optional.
 */

export const MESSAGING_JOBS = {
    /** A banned member's recent messages (D-181). */
    DELETE_RECENT: 'delete-recent'
} as const

export interface DeleteRecentJob {
    serverId: string
    userId: string
    from: string
    to: string
}
