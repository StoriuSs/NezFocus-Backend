import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { CommandBus } from '@nestjs/cqrs'
import { Job } from 'bullmq'
import { QUEUES } from '@/shared/infrastructure/queue/queues'
import { DeleteRecentMessagesCommand } from '../../application'
import { DeleteRecentJob, MESSAGING_JOBS } from '../../infrastructure/adapters/messaging-jobs'

/**
 * Messaging Jobs Consumer: Inbound Adapter
 *
 * Runs the jobs messaging queues, each through its command: a banned
 * member's recent messages (D-181). A job that throws is retried by the
 * queue (DEFAULT_JOB_OPTIONS).
 */
@Processor(QUEUES.MESSAGING)
export class MessagingJobsConsumer extends WorkerHost {
    private readonly logger = new Logger(MessagingJobsConsumer.name)

    constructor(private readonly commandBus: CommandBus) {
        super()
    }

    async process(job: Job): Promise<void> {
        if (job.name !== MESSAGING_JOBS.DELETE_RECENT) {
            this.logger.warn(`Unknown messaging job "${job.name}" (${job.id}), ignored`)
            return
        }
        const { serverId, userId, from, to } = job.data as DeleteRecentJob
        await this.commandBus.execute(new DeleteRecentMessagesCommand(serverId, userId, new Date(from), new Date(to)))
    }
}
