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
    MAINTENANCE: 'maintenance'
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
