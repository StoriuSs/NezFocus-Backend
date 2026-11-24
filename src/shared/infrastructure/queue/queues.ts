import { BullModule } from '@nestjs/bullmq'
import { DefaultJobOptions } from 'bullmq'

/**
 * Every BullMQ queue in the app. Name a queue here, never with a string at the
 * call site: a typo there creates a second queue nobody consumes.
 */
export const QUEUES = {
    /** Auth's emails (codes, password-changed notices). */
    AUTH: 'auth',
    /** Deletes stored files nothing references any more. */
    FILE_CLEANUP: 'file-cleanup',
    /** Every module's periodic jobs (src/maintenance/maintenance-tasks.ts). */
    MAINTENANCE: 'maintenance',
    /** Messaging's own work: deleting a banned member's recent messages (D-181). */
    MESSAGING: 'messaging',
    /**
     * The social module's timed work (ARCHITECTURE 6): a call still ringing
     * 45 seconds on. Each job carries the call's version and is dropped when
     * it no longer matches (D-242).
     */
    SOCIAL: 'social',
    /**
     * The study module's timed work (ARCHITECTURE 5): the end of a session's
     * phase, a Solo's 10 minutes of waiting, a room's 5 minutes empty, a
     * person's 3 minutes away (D-215). Each job carries the session's version
     * and is dropped when it no longer matches.
     */
    STUDY: 'study',
    /** The tasks module's own work: taking a member who left off their tasks (D-195), the due-date reminders (REQ-TASK-04). */
    TASKS: 'tasks'
} as const

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES]

/**
 * Defaults for every job, set once on the queue.
 *
 * - Retries span about 85 minutes (10 attempts, exponential from 10s). Jobs
 *   here call other services, and those restart: 5 attempts from 5s (~75s)
 *   did not outlast an ordinary dependency restart.
 * - Finished jobs are removed after a while. Completed jobs used to be removed
 *   at once, and failed jobs were kept forever, growing Redis without bound.
 *   Failed jobs stay two weeks: long enough to inspect in /admin/queues.
 */
export const DEFAULT_JOB_OPTIONS: DefaultJobOptions = {
    attempts: 10,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
    removeOnFail: { age: 14 * 24 * 60 * 60 }
}

/** Register queues by name, all with DEFAULT_JOB_OPTIONS. */
export const registerQueues = (...names: QueueName[]) =>
    BullModule.registerQueue(...names.map((name) => ({ name, defaultJobOptions: DEFAULT_JOB_OPTIONS })))

/**
 * A job id derived from what the job acts on, so enqueueing the same work
 * twice (a retried request, the sweep re-finding a row) is one job. BullMQ
 * reserves ':' in ids, hence the dash.
 */
export const jobIdFor = (kind: string, subject: string) => `${kind}-${subject}`
