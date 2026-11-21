import type { StreakState } from '../streak.rules'

/** What one count (chốt) of a participation did, for the summary and `streak.updated` (D-224). */
export interface StudyCount {
    userId: string
    sessionId: string
    /** The seconds this count added, the 16-hour cap applied (0 when nothing was new). */
    added: number
    /** The participation's seconds after the count: the person's own summary of the session (D-49). */
    seconds: number
    /** Where the participation is counted up to now: the client adds the focus time running after it. */
    countedUntil: Date
    /** The person's seconds of today in their zone, after the count. */
    todaySeconds: number
    /** The streak after the count, as stored. */
    streak: StreakState
    /** The streak to show today (shownStreak). */
    shownStreak: number
}

/**
 * The seconds studied (ARCHITECTURE 5.2, D-216, D-224): counts of
 * participations into DailyStudy, Participation.seconds and Streak. A count
 * that comes with a change of a session is written in that change's
 * transaction by the session's repository; this one is for a count on its
 * own (3 minutes away, D-215).
 */
export interface StudyTimeRepositoryPort {
    /**
     * Count what is new of the participation since its countedUntil, up to
     * now (or the time the person left or went away), the days in
     * `timeZone`, in one transaction under the locks of its session, the
     * participation, the days written and the streak. Null when there is no
     * such participation. The caller publishes StudyCountedEvent with the
     * result (`streak.updated`), as after any count.
     */
    count(participationId: string, timeZone: string): Promise<StudyCount | null>
}

export const STUDY_TIME_REPOSITORY = Symbol('StudyTimeRepositoryPort')
