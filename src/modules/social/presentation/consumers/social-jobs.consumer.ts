import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { CommandBus } from '@nestjs/cqrs'
import { Job } from 'bullmq'
import { QUEUES } from '@/shared/infrastructure/queue/queues'
import { CheckCallMediaCommand, RingOutCallCommand } from '../../application'
import { MediaCheckJob, RingOutJob, SOCIAL_JOBS } from '../../infrastructure/adapters/social-jobs'

/**
 * Social Jobs Consumer: Inbound Adapter
 *
 * Runs the jobs the social module queues, each through its command: a call
 * still ringing 45 seconds on, missed (REQ-SOCIAL-05); the deadline of an
 * answered call's media, failed or ended (D-242). A job that throws is
 * retried by the queue (DEFAULT_JOB_OPTIONS).
 */
@Processor(QUEUES.SOCIAL)
export class SocialJobsConsumer extends WorkerHost {
    private readonly logger = new Logger(SocialJobsConsumer.name)

    constructor(private readonly commandBus: CommandBus) {
        super()
    }

    async process(job: Job): Promise<void> {
        switch (job.name) {
            case SOCIAL_JOBS.RING_OUT: {
                const { callId, version } = job.data as RingOutJob
                await this.commandBus.execute(new RingOutCallCommand(callId, version))
                return
            }
            case SOCIAL_JOBS.MEDIA_CHECK: {
                const { callId, version } = job.data as MediaCheckJob
                await this.commandBus.execute(new CheckCallMediaCommand(callId, version))
                return
            }
            default:
                this.logger.warn(`Unknown social job "${job.name}" (${job.id}), ignored`)
        }
    }
}
