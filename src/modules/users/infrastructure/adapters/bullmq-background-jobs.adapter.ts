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
        await this.deleteFilesLater([storageKey])
    }

    async deleteFilesLater(storageKeys: string[]): Promise<void> {
        if (storageKeys.length === 0) return
        await this.fileQueue.addBulk(
            storageKeys.map(bareKey).map((filePath) => ({
                name: FILE_DELETE_JOB,
                data: { filePath },
                opts: { jobId: jobIdFor('file-delete', filePath.replace(/:/g, '_')) }
            }))
        )
    }
}

/** Rows written before avatars were stored as bare keys hold a URL ending in uploads/<key>. */
const bareKey = (storageKey: string): string =>
    storageKey.includes('uploads/') ? storageKey.split('uploads/')[1] : storageKey
