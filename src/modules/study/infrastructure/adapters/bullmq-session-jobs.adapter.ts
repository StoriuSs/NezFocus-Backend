import { Injectable } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { jobIdFor, QUEUES } from '@/shared/infrastructure/queue/queues'
import { SessionJobsPort } from '../../application/ports'
import { EndFocusPhaseJob, STUDY_JOBS, StudyJob } from './study-jobs'

/** A phase end's job, named by the session and its version (D-222): `focus-<sessionId>-<version>`. */
const phaseJobId = (sessionId: string, version: number) => jobIdFor('focus', `${sessionId}-${version}`)

/**
 * Jobs named by what they act on, so setting one twice is one job; retried
 * by the queue's defaults. A phase end waits in the queue until its time
 * (`delay`), in Redis, so a restart keeps it (NFR-REL-02).
 */
@Injectable()
export class BullMqSessionJobs implements SessionJobsPort {
    constructor(@InjectQueue(QUEUES.STUDY) private readonly queue: Queue<StudyJob>) {}

    async endPhaseAt(sessionId: string, version: number, at: Date): Promise<void> {
        await this.queue.add(STUDY_JOBS.END_PHASE, { sessionId, version } satisfies EndFocusPhaseJob, {
            jobId: phaseJobId(sessionId, version),
            delay: Math.max(0, at.getTime() - Date.now())
        })
    }

    async dropPhaseEnd(sessionId: string, version: number): Promise<void> {
        // A job running now is locked and stays: it reads the session again and does nothing.
        await this.queue.remove(phaseJobId(sessionId, version))
    }
}
