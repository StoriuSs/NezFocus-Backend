import { Injectable } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { QUEUES, jobIdFor } from '@/shared/infrastructure/queue/queues'
import { FILE_DELETE_JOB, FileCleanupJob } from '@/shared/infrastructure/storage/file-cleanup.consumer'
import { BackgroundJobsPort } from '@/modules/users/application/ports/background-jobs.port'

/**
 * BullMQ Background Jobs Adapter — Outbound Adapter
 *
 * Jobs are identified by what they act on, so scheduling the same work twice
 * — two concurrent account deletions, say — is a single job.
 */
@Injectable()
export class BullMqBackgroundJobs implements BackgroundJobsPort {
    constructor(@InjectQueue(QUEUES.FILE_CLEANUP) private readonly fileQueue: Queue<FileCleanupJob>) {}

    async deleteFileLater(storageKey: string): Promise<void> {
        // Rows written before avatars were stored as bare keys hold a URL
        // ending in uploads/<key>.
        if (storageKey.includes('uploads/')) storageKey = storageKey.split('uploads/')[1]

        await this.fileQueue.add(
            FILE_DELETE_JOB,
            { filePath: storageKey },
            { jobId: jobIdFor('file-delete', storageKey.replace(/:/g, '_')) }
        )
    }
}
