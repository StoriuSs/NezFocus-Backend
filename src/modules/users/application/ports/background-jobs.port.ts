/**
 * Background Jobs Port (Application Layer)
 *
 * Work the application hands off to run later, with retries. No knowledge of
 * BullMQ or any queue. Scheduling the same work twice must be safe: callers
 * don't check first.
 */
export interface BackgroundJobsPort {
    /** Delete a stored file nothing references any more. */
    deleteFileLater(storageKey: string): Promise<void>
}

export const BACKGROUND_JOBS = Symbol('BackgroundJobsPort')
