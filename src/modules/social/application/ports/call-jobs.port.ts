/**
 * Call Jobs Port: the timed work of calls handed to the `social` queue
 * (ARCHITECTURE 6), so it waits in Redis and survives a restart
 * (NFR-REL-02). Each job is named by its call and the version it was set
 * for (`call-<id>-<kind>-<version>`, D-242), and does nothing once the call
 * changed: one left behind does no harm. The sweep runs what a lost job
 * would have.
 */
export interface CallJobsPort {
    /** Miss at `at` the call still ringing at `version` (45 seconds, `no_answer`). Setting the same one twice is one job. */
    ringOutAt(callId: string, version: number, at: Date): Promise<void>

    /** Drop the ring-out set for `version`, still waiting: the call changed. One running now is not stopped. */
    dropRingOut(callId: string, version: number): Promise<void>
}

export const CALL_JOBS = Symbol('CallJobsPort')
