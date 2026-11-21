import type { Cycle, FocusSession, SessionMove } from '../focus-session.rules'
import type { StudyCount } from './study-time.repository.port'

/** One person's seconds in a session that ended: their own summary (D-49). */
export interface SessionSummary {
    userId: string
    seconds: number
}

/** A Room Session to start (REQ-STUDY-02). */
export interface RoomSessionStart {
    serverId: string
    channelId: string
    /** The one who pressed Bắt đầu: its Host. */
    hostId: string
    cycle: Cycle
    /** How long a study minute is (D-221). */
    minuteMs: number
}

/** A Room Session just started, and the people it opened a participation for. */
export interface StartedSession {
    session: FocusSession
    participantIds: string[]
}

/** What a change of a session did, after its commit. */
export interface SessionChange {
    before: FocusSession
    /** The session as written; `before` when nothing was. */
    after: FocusSession
    /** False when nothing was written: another change came first (version), or there was nothing to do (D-225). */
    changed: boolean
    /** The counts the change made, one per participation it counted (D-224): each is told as StudyCountedEvent. */
    counts: StudyCount[]
    /** Once the session ended: every participant's seconds in it, in userId order (D-49). */
    summaries: SessionSummary[] | null
}

/** Decides a change from the session as it is once locked, at `at` (read after the lock); null to change nothing. */
export type SessionDecision = (session: FocusSession, at: Date) => SessionMove | null

/** A person's time zone, for the days a count goes to (FALLBACK_TIME_ZONE when they set none). */
export type ZoneOf = (userId: string) => Promise<string>

/**
 * Study sessions (ARCHITECTURE 5.1, D-222): the only writer of FocusSession,
 * FocusStretch and Participation, and of the counts a change makes
 * (study-counts, D-224). Every write locks the session row, decides on it as
 * it is, writes, counts, in one transaction.
 */
export interface FocusSessionRepositoryPort {
    /** The session, ended or not; null when there is none by that id. */
    find(sessionId: string): Promise<FocusSession | null>

    /** The session not yet ended of each room asked for that has one (D-220). */
    openInRooms(channelIds: string[]): Promise<Map<string, FocusSession>>

    /**
     * Starts a Room Session: running its first focus phase from now, its first
     * stretch open, and a participation from now for each person `peopleIn`
     * names (those in the room, REQ-STUDY-02). `peopleIn` is read under the
     * room's lock, which a join to the room takes too, so someone joining as
     * the session starts is either read here or finds the session. A person
     * already in another session is left out (L3b closes it first).
     * FocusSessionActiveError when the room has a session not yet ended.
     */
    startInRoom(start: RoomSessionStart, peopleIn: () => Promise<string[]>): Promise<StartedSession>

    /**
     * Changes a session as `decide` says, made at now (read once the row is
     * locked): writes the row with its version raised, closes and opens the
     * stretches, counts every open participation when a stretch closed or the
     * session ended (in userId order, each in its person's zone), and closes
     * them all when it ended: at the time they went away, if away (D-215).
     * `version`, when given, is the one the client saw: another one written
     * since changes nothing (D-225). Null when there is no such session.
     */
    change(
        sessionId: string,
        version: number | null,
        decide: SessionDecision,
        zoneOf: ZoneOf
    ): Promise<SessionChange | null>

    /** Sessions running whose phase was due at `now` or before (a job lost or late, D-225), the oldest first. */
    overdue(now: Date, limit: number): Promise<{ id: string; version: number }[]>
}

export const FOCUS_SESSION_REPOSITORY = Symbol('FocusSessionRepositoryPort')
