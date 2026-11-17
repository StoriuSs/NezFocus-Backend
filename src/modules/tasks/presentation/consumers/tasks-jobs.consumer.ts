import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { CommandBus } from '@nestjs/cqrs'
import { Job } from 'bullmq'
import { QUEUES } from '@/shared/infrastructure/queue/queues'
import { UnassignLeftMemberCommand } from '../../application'
import { TASKS_JOBS, UnassignLeftMemberJob } from '../../infrastructure/adapters/tasks-jobs'

/**
 * Tasks Jobs Consumer: Inbound Adapter
 *
 * Runs the jobs the tasks module queues, each through its command: a member
 * who left a server taken off its tasks (D-195). A job that throws is retried
 * by the queue (DEFAULT_JOB_OPTIONS).
 */
@Processor(QUEUES.TASKS)
export class TasksJobsConsumer extends WorkerHost {
    private readonly logger = new Logger(TasksJobsConsumer.name)

    constructor(private readonly commandBus: CommandBus) {
        super()
    }

    async process(job: Job): Promise<void> {
        if (job.name !== TASKS_JOBS.UNASSIGN_LEFT_MEMBER) {
            this.logger.warn(`Unknown tasks job "${job.name}" (${job.id}), ignored`)
            return
        }
        const { serverId, userId } = job.data as UnassignLeftMemberJob
        await this.commandBus.execute(new UnassignLeftMemberCommand(serverId, userId))
    }
}
