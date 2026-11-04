import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { Job } from 'bullmq'
import { UploadService } from './upload.service'
import { QUEUES } from '../queue/queues'

/** The job's name. Any module that stores files adds it, with a FileCleanupJob. */
export const FILE_DELETE_JOB = 'delete-file'

export interface FileCleanupJob {
    /** Storage key of the file to delete. */
    filePath: string
}

/**
 * Deletes stored files that nothing references any more.
 *
 * Lives with the storage module, not a feature module: any module that stores
 * files schedules deletions on this queue, and there must be exactly one
 * consumer. Deleting a file that is already gone succeeds, so a job that runs
 * twice is harmless. Failures are retried with the queue's defaults.
 */
@Processor(QUEUES.FILE_CLEANUP)
export class FileCleanupConsumer extends WorkerHost {
    private readonly logger = new Logger(FileCleanupConsumer.name)

    constructor(private readonly uploadService: UploadService) {
        super()
    }

    async process(job: Job<FileCleanupJob>): Promise<void> {
        const { filePath } = job.data
        try {
            await this.uploadService.deleteFile(filePath)
            this.logger.debug(`Deleted file: ${filePath}`)
        } catch (error) {
            this.logger.error(
                `Failed to delete file ${filePath} (attempt ${job.attemptsMade + 1}): ${(error as Error).message}`
            )
            throw error
        }
    }
}
