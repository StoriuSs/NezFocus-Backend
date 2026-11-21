/*
 * The jobs on the `study` queue: their names and what each carries. One
 * contract for both sides: BullMqSessionJobs adds them, StudyJobsConsumer
 * runs them. Job data is JSON. A job already in Redis was written with an
 * earlier version of these, so a field added later stays optional.
 */

export const STUDY_JOBS = {
    /** The end of a session's running phase (ARCHITECTURE 5.1). */
    END_PHASE: 'end-focus-phase',
    /** The place of someone away closed, 3 minutes on (D-215). */
    CLOSE_AWAY: 'close-away',
    /** The end of a Room Session whose room stayed empty 5 minutes (D-227). */
    END_EMPTY: 'end-empty-room'
} as const

/** Only what to read again when it runs: the session, and the version it was set for (D-222). */
export interface EndFocusPhaseJob {
    sessionId: string
    version: number
}

/** The participation, and when its person went away (ISO): one back, or away again since, is left alone. */
export interface CloseAwayJob {
    participationId: string
    since: string
}

/** The session, and since when its room is empty (ISO): someone came in, or it went empty again since, and it is left alone. */
export interface EndEmptyRoomJob {
    sessionId: string
    since: string
}

export type StudyJob = EndFocusPhaseJob | CloseAwayJob | EndEmptyRoomJob
