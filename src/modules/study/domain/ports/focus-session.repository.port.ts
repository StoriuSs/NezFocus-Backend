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

/** A Room Session just started, the people it opened a participation for, and the Solos it ended for them (D-103). */
export interface StartedSession {
    session: FocusSession
    participantIds: string[]
    yielded: SessionChange[]
}

/** A Solo to start (REQ-STUDY-05). */
export interface SoloStart {
    userId: string
    cycle: Cycle
    /** How long a study minute is (D-221). */
    minuteMs: number
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

/** Whether a person may start a session in study room `channelId`, so may be its Host (REQ-STUDY-03). */
export type MayHost = (channelId: string, userId: string) => Promise<boolean>

/** What a change of who is in a Room Session did, after its commit. */
export interface PresenceChange extends SessionChange {
    /** Set when it made the person away (D-215): their place is closed AWAY_MINUTES after `since`, unless back. */
    away: { participationId: string; since: Date } | null
    /** Set when it left nobody present (D-227): the session ends EMPTY_MINUTES after it, unless someone comes. */
    emptySince: Date | null
}

/**
 * A join of a study room, as decided under its lock: the person still has a
 * participation open in another room's session, to close first; no session
 * there; the room has no Host and whether this person may be one was not
 * given, to ask; they have a Solo to end and their zone was not given, to
 * read; or done, with the Solo it ended for them, if any (D-103). Nothing is
 * written but for `joined`.
 */
export type JoinOutcome =
    | { kind: 'no_session' }
    | { kind: 'elsewhere'; sessionId: string }
    | { kind: 'ask' }
    | { kind: 'zone' }
    | { kind: 'joined'; change: PresenceChange; yielded: SessionChange | null }

/**
 * Which participation a leave closes: the person's in the room's session, in
 * a session named, or in whichever Room Session they have one (they asked to
 * leave their room, D-228).
 */
export type LeaveFrom = { channelId: string } | { sessionId: string } | { anyRoom: true }

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

    /** The Room Sessions not yet ended of a server's rooms, those of rooms deleted since included (D-223, D-227). */
    openInServer(serverId: string): Promise<FocusSession[]>

    /** A person's Solo not yet ended; null when they have none (REQ-STUDY-05). */
    openSolo(userId: string): Promise<FocusSession | null>

    /** The cycle of a person's last Solo, ended or not; null when they never had one (D-103). */
    lastSoloCycle(userId: string): Promise<Cycle | null>

    /**
     * Starts a Solo: running its first focus phase from now, its stretch
     * open, and its one participation from now (D-223).
     * FocusSessionActiveError when the person has a participation open
     * already (in a Room Session, away from it included, or another Solo):
     * Participation_one_open_per_person decides it, also between two at once.
     */
    startSolo(start: SoloStart): Promise<FocusSession>

    /**
     * Starts a Room Session: running its first focus phase from now, its first
     * stretch open, and a participation from now for each person `peopleIn`
     * names (those in the room, REQ-STUDY-02). `peopleIn` is read under the
     * room's lock, which a join to the room takes too, so someone joining as
     * the session starts is either read here or finds the session. One in a
     * Solo has it ended in the same transaction (`joined_room`, counted in
     * their zone by `zoneOf`: the caller reads those in the room before; one
     * come in meanwhile is read inside, as the last run of `change` does),
     * their participation opened when it ends: no second lost or counted
     * twice (D-103). A person still in another room's session is
     * left out (the sweep joins them once that closes).
     * FocusSessionActiveError when the room has a session not yet ended.
     */
    startInRoom(start: RoomSessionStart, peopleIn: () => Promise<string[]>, zoneOf: ZoneOf): Promise<StartedSession>

    /**
     * Changes a session as `decide` says, made at now (read once the row is
     * locked): writes the row with its version raised, closes and opens the
     * stretches, counts every open participation when a stretch closed or the
     * session ended (in userId order, each in its person's zone), and one
     * closed before all of it was counted (left while a phase was overdue),
     * and closes them all when it ended: at the time they went away, if away
     * (D-215).
     * `version`, when given, is the one the client saw: another one written
     * since changes nothing (D-225). Null when there is no such session.
     */
    change(
        sessionId: string,
        version: number | null,
        decide: SessionDecision,
        zoneOf: ZoneOf
    ): Promise<SessionChange | null>

    /**
     * Sessions whose timer was due at `now` or before (a job lost or late,
     * D-225): running ones whose phase was due, waiting Solos whose wait
     * ended; the oldest first.
     */
    overdue(now: Date, limit: number): Promise<{ id: string; version: number }[]>

    /**
     * Someone came into study room `channelId` (ARCHITECTURE 5.2), under the
     * room's lock, which a start takes too: one joining as a session starts is
     * either read by the start or finds the session here. A participation
     * still open in another room's session (away from it, D-215): nothing
     * written, `elsewhere` (the caller closes it, then joins again). A Solo,
     * when this room has a session, ends in the same transaction
     * (`joined_room`, counted in `zone`, their time zone) and the participation
     * here opens when it ends (D-103); `zone` null, not read yet: `zone`, so
     * only a join that needs it reads it, outside the transaction. Else, no
     * session not yet ended in
     * the room: nothing. One open in this session already (read by the start, or a
     * reload): back from away if away (the time away counts, D-215), else
     * nothing. Else a participation from now. Someone present again clears
     * the room's emptiness; a room with no Host gets this person as Host when
     * `mayHost` (the version raised); null, not asked yet: `ask` when the room
     * has no Host, so only a join that needs it asks.
     */
    joinRoom(channelId: string, userId: string, mayHost: boolean | null, zone: string | null): Promise<JoinOutcome>

    /**
     * Someone went out (D-215): `lost`, their connection lost, so they are
     * away from now and keep their place and their Host for AWAY_MINUTES;
     * else their participation is counted and closed now (at the time they
     * went away, if away), and if they were Host the next one is chosen
     * (nextHost, asking `mayHost` about those present; the version raised).
     * Nobody present after it: the room is empty from now. Null when the
     * person has no participation open there.
     */
    leave(
        from: LeaveFrom,
        userId: string,
        lost: boolean,
        mayHost: MayHost,
        zoneOf: ZoneOf
    ): Promise<PresenceChange | null>

    /**
     * The place of one away since `since` closed, AWAY_MINUTES on (D-215):
     * counted up to then and closed there, the next Host chosen if they were
     * Host. Null when they came back, left or went away again since.
     */
    closeAway(participationId: string, since: Date, mayHost: MayHost, zoneOf: ZoneOf): Promise<PresenceChange | null>

    /** Rooms empty since `before` or earlier, their session not ended (D-227), the oldest first. */
    emptySince(before: Date, limit: number): Promise<{ id: string; emptySince: Date }[]>

    /** Participations away since `before` or earlier, still open (D-215), the oldest first. */
    awaySince(before: Date, limit: number): Promise<{ id: string; awaySince: Date }[]>

    /**
     * Every Room Session not ended, each with its room and the people present
     * (open, not away), for the sweep (D-225): all of them each run, as one
     * checked stays open (one per room at most).
     */
    openRooms(): Promise<OpenRoom[]>
}

/** A Room Session not ended, as the sweep reads it. */
export interface OpenRoom {
    sessionId: string
    channelId: string
    /** Who has an open participation and is not away, by userId. */
    present: string[]
}

export const FOCUS_SESSION_REPOSITORY = Symbol('FocusSessionRepositoryPort')
