/** Work handed to the queue, retried there. Scheduling the same file twice is one job. */
export interface FileCleanupPort {
    /** Delete a stored file nothing references any more. */
    deleteFileLater(key: string): Promise<void>
}

export const FILE_CLEANUP = Symbol('FileCleanupPort')
