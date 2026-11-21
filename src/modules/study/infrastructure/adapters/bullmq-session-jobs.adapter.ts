import { Injectable } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { jobIdFor, QUEUES } from '@/shared/infrastructure/queue/queues'
import { SessionJobsPort } from '../../application/ports'
import { CloseAwayJob, EndEmptyRoomJob, EndFocusPhaseJob, STUDY_JOBS, StudyJob } from './study-jobs'

/** A phase end's job, named by the session and its version (D-222): `focus-<sessionId>-<version>`. */
const phaseJobId = (sessionId: string, version: number) => jobIdFor('focus', `${sessionId}-${version}`)

/** How long from now until `at`: none once it has passed. */
const delayUntil = (at: Date) => Math.max(0, at.getTime() - Date.now())

/**
 * Jobs named by what they act on, so setting one twice is one job; retried
 * by the queue's defaults. Each waits in the queue until its time (`delay`),
 * in Redis, so a restart keeps it (NFR-REL-02).
 */
@Injectable()
export class BullMqSessionJobs implements SessionJobsPort {
    constructor(@InjectQueue(QUEUES.STUDY) private readonly queue: Queue<StudyJob>) {}

    async endPhaseAt(sessionId: string, version: number, at: Date): Promise<void> {
        await this.queue.add(STUDY_JOBS.END_PHASE, { sessionId, version } satisfies EndFocusPhaseJob, {
            jobId: phaseJobId(sessionId, version),
            delay: delayUntil(at)
        })
    }

    async dropPhaseEnd(sessionId: string, version: number): Promise<void> {
        // A job running now is locked and stays: it reads the session again and does nothing.
        await this.queue.remove(phaseJobId(sessionId, version))
    }

    async closeAwayAt(participationId: string, since: Date, at: Date): Promise<void> {
        await this.queue.add(
            STUDY_JOBS.CLOSE_AWAY,
            { participationId, since: since.toISOString() } satisfies CloseAwayJob,
            // `away-<participationId>-<sinceMs>`: away again later is another job.
            { jobId: jobIdFor('away', `${participationId}-${since.getTime()}`), delay: delayUntil(at) }
        )
    }

    async endEmptyAt(sessionId: string, since: Date, at: Date): Promise<void> {
        await this.queue.add(
            STUDY_JOBS.END_EMPTY,
            { sessionId, since: since.toISOString() } satisfies EndEmptyRoomJob,
            // `empty-<sessionId>-<sinceMs>` (D-227): empty again later is another job.
            { jobId: jobIdFor('empty', `${sessionId}-${since.getTime()}`), delay: delayUntil(at) }
        )
    }
}
