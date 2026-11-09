import { Injectable } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { QUEUES, jobIdFor } from '@/shared/infrastructure/queue/queues'
import { FILE_DELETE_JOB, FileCleanupJob } from '@/shared/infrastructure/storage/file-cleanup.consumer'
import { FileCleanupPort } from '../../application/ports'

/** Jobs named by the file they delete, so scheduling one twice is one job. */
@Injectable()
export class BullMqFileCleanup implements FileCleanupPort {
    constructor(@InjectQueue(QUEUES.FILE_CLEANUP) private readonly queue: Queue<FileCleanupJob>) {}

    async deleteFileLater(key: string): Promise<void> {
        await this.queue.add(
            FILE_DELETE_JOB,
            { filePath: key },
            { jobId: jobIdFor('file-delete', key.replace(/:/g, '_')) }
        )
    }
}
