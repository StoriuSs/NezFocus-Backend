import { Injectable } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { QUEUES, jobIdFor } from '@/shared/infrastructure/queue/queues'
import { TaskJobsPort } from '../../application/ports'
import { TASKS_JOBS, UnassignLeftMemberJob } from './tasks-jobs'

/** Jobs named by the leave (where, who, when), so queueing one twice is one job; retried by the queue's defaults. */
@Injectable()
export class BullMqTaskJobs implements TaskJobsPort {
    constructor(@InjectQueue(QUEUES.TASKS) private readonly queue: Queue<UnassignLeftMemberJob>) {}

    async unassignLeftMemberLater(serverId: string, userId: string, leftAt: Date): Promise<void> {
        await this.queue.add(
            TASKS_JOBS.UNASSIGN_LEFT_MEMBER,
            { serverId, userId },
            { jobId: jobIdFor('unassign-left-member', `${serverId}-${userId}-${leftAt.getTime()}`) }
        )
    }
}
