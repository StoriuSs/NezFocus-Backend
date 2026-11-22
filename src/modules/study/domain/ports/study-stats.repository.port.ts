import type { SessionKind } from '../focus-session.rules'
import type { StreakState } from '../streak.rules'
import type { LocalDate } from '../study-time.rules'

/** One day of DailyStudy (D-104): room + solo = focused. */
export interface DayStudy {
    date: LocalDate
    focusedSeconds: number
    roomSeconds: number
    soloSeconds: number
}

/** Everything a person has studied. */
export interface StudyLifetime {
    totalSeconds: number
    /** The first day with a second counted; null when none has been. */
    firstDate: LocalDate | null
}

/**
 * One session of a person in their history (D-105): all their
 * participations in it as one line.
 */
export interface HistoryRow {
    sessionId: string
    kind: SessionKind
    /** A Room Session's room and server; null for a Solo. */
    serverId: string | null
    channelId: string | null
    /** Their first join: where the line sits, and the period it belongs to (D-229). */
    firstJoinedAt: Date
    /** Their last leave; null while they are in it (away included). */
    lastLeftAt: Date | null
    /** The seconds counted for them in it so far. */
    seconds: number
    joinCount: number
}

/** The instants a line's first join falls in, `to` not included. */
export interface HistoryWindow {
    from: Date
    to: Date
}

/** Where the next page starts: after this line. */
export interface HistoryCursor {
    firstJoinedAt: Date
    sessionId: string
}

/**
 * What the Stats page reads (REQ-STUDY-07, D-104, D-105, D-230): the days of
 * DailyStudy, the streak, and the history of sessions.
 */
export interface StudyStatsRepositoryPort {
    /** The person's days from `from` to `to`, both in, that have a row, in order. */
    daysOf(userId: string, from: LocalDate, to: LocalDate): Promise<DayStudy[]>

    /** Their focused seconds from `from` to `to`, both in. */
    secondsBetween(userId: string, from: LocalDate, to: LocalDate): Promise<number>

    lifetimeOf(userId: string): Promise<StudyLifetime>

    /**
     * The greatest total of a week (Monday to Sunday) with seconds, other
     * than the one starting `weekStart`; null when no other has any.
     */
    bestWeekExcept(userId: string, weekStart: LocalDate): Promise<number | null>

    /** Their streak as stored; none yet is NO_STREAK. */
    streakOf(userId: string): Promise<StreakState>

    /** The session they are in now, when their first join in it is in `window`, whatever its seconds. */
    openLineOf(userId: string, window: HistoryWindow): Promise<HistoryRow | null>

    /**
     * Up to `limit` of the sessions they are no longer in, with their first
     * join in `window` and a second counted, the latest first join first,
     * then the greater id; after `cursor` when given.
     */
    linesOf(userId: string, window: HistoryWindow, cursor: HistoryCursor | null, limit: number): Promise<HistoryRow[]>

    /** Their first join in the session; null when they never joined it. */
    firstJoinOf(userId: string, sessionId: string): Promise<Date | null>
}

export const STUDY_STATS_REPOSITORY = Symbol('StudyStatsRepositoryPort')
