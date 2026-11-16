import { Injectable } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import type { MessageWindow } from '@/modules/servers'
import { QUEUES, jobIdFor } from '@/shared/infrastructure/queue/queues'
import { MessagePurgePort } from '../../application/ports'
import { DeleteRecentJob, MESSAGING_JOBS } from './messaging-jobs'

/** Jobs named by the ban (who, where, when), so queueing one twice is one job; retried by the queue's defaults. */
@Injectable()
export class BullMqMessagePurge implements MessagePurgePort {
    constructor(@InjectQueue(QUEUES.MESSAGING) private readonly queue: Queue<DeleteRecentJob>) {}

    async deleteRecentLater(serverId: string, userId: string, { from, to }: MessageWindow): Promise<void> {
        await this.queue.add(
            MESSAGING_JOBS.DELETE_RECENT,
            { serverId, userId, from: from.toISOString(), to: to.toISOString() },
            { jobId: jobIdFor('delete-recent', `${serverId}-${userId}-${to.getTime()}`) }
        )
    }
}
