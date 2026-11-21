/**
 * Session Jobs Port: the timed work of study sessions handed to the `study`
 * queue (ARCHITECTURE 5.1), so it waits in Redis and survives a restart
 * (NFR-REL-02). Each job is named by its session and the version it was set
 * for, and does nothing once the session changed (D-222): one left behind
 * does no harm. The sweep runs what a lost job would have (D-225).
 */
export interface SessionJobsPort {
    /** End the running phase of the session at `at`, if it is still at `version` then. Setting the same one twice is one job. */
    endPhaseAt(sessionId: string, version: number, at: Date): Promise<void>

    /** Drop the phase end set for `version`, still waiting: the session changed. One running now is not stopped. */
    dropPhaseEnd(sessionId: string, version: number): Promise<void>
}

export const SESSION_JOBS = Symbol('SessionJobsPort')
