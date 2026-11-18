import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { CommandBus } from '@nestjs/cqrs'
import { Job } from 'bullmq'
import { QUEUES } from '@/shared/infrastructure/queue/queues'
import { SendTaskReminderCommand, UnassignLeftMemberCommand } from '../../application'
import { SendTaskReminderJob, TASKS_JOBS, UnassignLeftMemberJob } from '../../infrastructure/adapters/tasks-jobs'

/**
 * Tasks Jobs Consumer: Inbound Adapter
 *
 * Runs the jobs the tasks module queues, each through its command: a member
 * who left a server taken off its tasks (D-195), a task's reminder at its
 * time (REQ-TASK-04). A job that throws is retried by the queue
 * (DEFAULT_JOB_OPTIONS).
 */
@Processor(QUEUES.TASKS)
export class TasksJobsConsumer extends WorkerHost {
    private readonly logger = new Logger(TasksJobsConsumer.name)

    constructor(private readonly commandBus: CommandBus) {
        super()
    }

    async process(job: Job): Promise<void> {
        switch (job.name) {
            case TASKS_JOBS.UNASSIGN_LEFT_MEMBER: {
                const { serverId, userId } = job.data as UnassignLeftMemberJob
                await this.commandBus.execute(new UnassignLeftMemberCommand(serverId, userId))
                return
            }
            case TASKS_JOBS.SEND_REMINDER: {
                const { taskId, mark, dueAt } = job.data as SendTaskReminderJob
                await this.commandBus.execute(new SendTaskReminderCommand(taskId, mark, new Date(dueAt)))
                return
            }
            default:
                this.logger.warn(`Unknown tasks job "${job.name}" (${job.id}), ignored`)
        }
    }
}
