/** Work handed to the queue, retried there. Scheduling the same file twice is one job. */
export interface FileCleanupPort {
    /** Delete a stored file nothing references any more; `afterMs` from now, if given. */
    deleteFileLater(key: string, afterMs?: number): Promise<void>
}

export const FILE_CLEANUP = Symbol('FileCleanupPort')
