import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { DiscoveryService } from '@nestjs/core'
import type { Job } from 'bullmq'
import { reportError } from '@/shared/infrastructure/monitoring/error-reporting'
import { findWorkers } from './registered-queues'

type FailureSource = {
    name: string
    on(event: 'failed', listener: (job: Job | undefined, error: Error) => void): unknown
}

/**
 * A job that has used up its retries: logged, and sent to error tracking.
 *
 * Nothing needs a person until then. Processors log each failed attempt
 * themselves, and the Sentry SDK does not report them (its NestJS integration
 * is left out: see config/sentry.config.ts), so a job retried ten times over
 * an outage is one event, not ten. Without this, a job that gave up was
 * visible only as a number on the Redis dashboard.
 */
@Injectable()
export class QueueFailureReporter implements OnApplicationBootstrap {
    private readonly logger = new Logger(QueueFailureReporter.name)

    constructor(private readonly discovery: DiscoveryService) {}

    onApplicationBootstrap() {
        for (const worker of findWorkers(this.discovery)) this.listen(worker)
    }

    private listen(worker: FailureSource) {
        worker.on('failed', (job, error) => {
            // BullMQ emits 'failed' after every attempt; finishedOn is set only
            // when the job is not going to be retried.
            if (!job || typeof job.finishedOn !== 'number') return
            this.logger.error({
                msg: `Job ${job.name} of ${worker.name} failed after ${job.attemptsMade} attempt(s): ${error.message}`,
                queue: worker.name,
                jobId: job.id,
                jobName: job.name,
                attempts: job.attemptsMade
            })
            reportError(error, {
                tags: { queue: worker.name, job_name: job.name, attempts: job.attemptsMade },
                // Not the job's data: it can hold anything, personal data included.
                extra: { jobId: job.id }
            })
        })
    }
}
