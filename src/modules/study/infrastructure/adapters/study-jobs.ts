/*
 * The jobs on the `study` queue: their names and what each carries. One
 * contract for both sides: BullMqSessionJobs adds them, StudyJobsConsumer
 * runs them. Job data is JSON. A job already in Redis was written with an
 * earlier version of these, so a field added later stays optional.
 */

export const STUDY_JOBS = {
    /** The end of a session's running phase (ARCHITECTURE 5.1). */
    END_PHASE: 'end-focus-phase'
} as const

/** Only what to read again when it runs: the session, and the version it was set for (D-222). */
export interface EndFocusPhaseJob {
    sessionId: string
    version: number
}

export type StudyJob = EndFocusPhaseJob
