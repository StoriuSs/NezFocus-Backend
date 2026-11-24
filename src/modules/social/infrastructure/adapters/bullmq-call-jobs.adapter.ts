import { Injectable } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { jobIdFor, QUEUES } from '@/shared/infrastructure/queue/queues'
import { CallJobsPort } from '../../application/ports'
import { MediaCheckJob, RingOutJob, SOCIAL_JOBS, SocialJob } from './social-jobs'

/** A ring-out's job, named by the call and its version (D-242): `call-<callId>-ring-<version>`. */
const ringOutJobId = (callId: string, version: number) => jobIdFor('call', `${callId}-ring-${version}`)

/** A media check's job, the same way (D-242): `call-<callId>-media-<version>`. */
const mediaCheckJobId = (callId: string, version: number) => jobIdFor('call', `${callId}-media-${version}`)

/** How long from now until `at`: none once it has passed. */
const delayUntil = (at: Date) => Math.max(0, at.getTime() - Date.now())

/**
 * Jobs named by what they act on, so setting one twice is one job; retried
 * by the queue's defaults. Each waits in the queue until its time (`delay`),
 * in Redis, so a restart keeps it (NFR-REL-02).
 */
@Injectable()
export class BullMqCallJobs implements CallJobsPort {
    constructor(@InjectQueue(QUEUES.SOCIAL) private readonly queue: Queue<SocialJob>) {}

    async ringOutAt(callId: string, version: number, at: Date): Promise<void> {
        await this.queue.add(SOCIAL_JOBS.RING_OUT, { callId, version } satisfies RingOutJob, {
            jobId: ringOutJobId(callId, version),
            delay: delayUntil(at)
        })
    }

    async dropRingOut(callId: string, version: number): Promise<void> {
        // A job running now is locked and stays: it reads the call again and does nothing.
        await this.queue.remove(ringOutJobId(callId, version))
    }

    async checkMediaAt(callId: string, version: number, at: Date): Promise<void> {
        await this.queue.add(SOCIAL_JOBS.MEDIA_CHECK, { callId, version } satisfies MediaCheckJob, {
            jobId: mediaCheckJobId(callId, version),
            delay: delayUntil(at)
        })
    }

    async dropMediaCheck(callId: string, version: number): Promise<void> {
        await this.queue.remove(mediaCheckJobId(callId, version))
    }
}
