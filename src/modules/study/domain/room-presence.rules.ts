/*
 * Who is in a Room Session (ARCHITECTURE 5.2, 5.3): how long one whose
 * connection was lost keeps their place, how long an empty room keeps its
 * session, and who becomes Host when the Host leaves.
 */
import { caughtUp, EndReason, FocusSession, SessionMove, stopMove } from './focus-session.rules'

/** How long someone whose connection was lost keeps their place and their Host (D-215), in study minutes. */
export const AWAY_MINUTES = 3

/** How long a room with nobody present keeps its session (REQ-STUDY-02), in study minutes. */
export const EMPTY_MINUTES = 5

/** When a timer set at `since` for `minutes` study minutes is due (D-221). */
export const dueAt = (since: Date, minutes: number, minuteMs: number): Date =>
    new Date(since.getTime() + minutes * minuteMs)

/** Someone present in a Room Session (an open participation, not away), as choosing its Host reads them. */
export interface Present {
    userId: string
    /** When their participation began: a reload keeps it, leaving and coming back makes a new one. */
    joinedAt: Date
}

/**
 * The next Host (REQ-STUDY-03, D-222): of those present, the one whose
 * participation began first and who may start a session in the room. One
 * away is not present (D-215): they become Host only by coming back to a
 * room with none. Null when nobody present may: the session runs on with no
 * Host. Undefined when someone present was not asked about (`mayHost` has
 * no answer for them: they came in since it was read), before anyone who
 * may: ask again.
 */
export function nextHost(
    present: readonly Present[],
    mayHost: ReadonlyMap<string, boolean>
): string | null | undefined {
    const ordered = [...present].sort(
        (a, b) => a.joinedAt.getTime() - b.joinedAt.getTime() || a.userId.localeCompare(b.userId)
    )
    for (const { userId } of ordered) {
        const may = mayHost.get(userId)
        if (may === undefined) return undefined
        if (may) return userId
    }
    return null
}

/** The later of the times given. */
const latest = (first: Date, second: Date): Date => (second > first ? second : first)

/** A person's open participation, as the presence rules read it once locked. */
export interface Place {
    userId: string
    awaySince: Date | null
    countedUntil: Date
}

/** A person's place after a change of who is present: away from a time, or closed at one (counted up to it first). */
export type PlaceChange = { awaySince: Date } | { leftAt: Date }

/** What a person going away or leaving does to a session (presenceMove). */
export interface PresenceMove {
    place: PlaceChange
    /** The Host after it: a new one raises the version (D-225). */
    hostId: string | null
    /** Set when it leaves nobody present (D-227): the room is empty from then. */
    emptySince: Date | null
}

/**
 * Someone going out of a Room Session at `at` (ARCHITECTURE 5.2, 5.3):
 * `away`, their connection lost (D-215): away from then, keeping their place
 * and their Host; `leave`: closed then, or at the time they went away if
 * away, and a Host hands over (nextHost of `present`, the others present).
 * Never before what is counted already (Participation_time_check: another
 * app's clock may be a little ahead). Nobody present after it: a room
 * session not empty yet is empty from `at`. Undefined when the next Host
 * needs `mayHost` to answer for someone it does not know yet.
 */
export function presenceMove(
    session: Pick<FocusSession, 'kind' | 'hostId' | 'emptySince'>,
    place: Place,
    step: 'away' | 'leave',
    at: Date,
    present: readonly Present[],
    mayHost: ReadonlyMap<string, boolean>
): PresenceMove | undefined {
    let hostId = session.hostId
    if (step === 'leave' && session.hostId === place.userId) {
        const next = nextHost(present, mayHost)
        if (next === undefined) return undefined
        hostId = next
    }
    return {
        place:
            step === 'away'
                ? { awaySince: latest(at, place.countedUntil) }
                : { leftAt: latest(place.awaySince ?? at, place.countedUntil) },
        hostId,
        emptySince: session.kind === 'room' && present.length === 0 && !session.emptySince ? at : null
    }
}

/** What a join of a room with a session does (joinMove). */
export interface JoinMove {
    /** A new participation from `at`; else the open one goes on. */
    opens: boolean
    /** The open one was away: back, the time away counted (D-215). */
    back: boolean
    /** Becomes Host (the room had none, and they may start): the version raised. */
    becomesHost: boolean
    /** Someone present again: the room is no longer empty (D-227). */
    endsEmptiness: boolean
}

/**
 * Someone coming into a room with a session (ARCHITECTURE 5.2): a place
 * from now, or the one they have (read by the start, a reload) going on, back
 * from away if away. A room with no Host gets them as Host when they may
 * start; `mayHost` null, not asked yet: `ask` (only a room with no Host
 * needs it).
 */
export function joinMove(
    session: Pick<FocusSession, 'hostId' | 'emptySince'>,
    place: Pick<Place, 'awaySince'> | null,
    mayHost: boolean | null
): JoinMove | 'ask' {
    if (session.hostId === null && mayHost === null) return 'ask'
    return {
        opens: place === null,
        back: place?.awaySince != null,
        becomesHost: session.hostId === null && mayHost === true,
        endsEmptiness: session.emptySince !== null
    }
}

/**
 * Whether the place of one away since `since` closes at `at` (D-215): once
 * AWAY_MINUTES have passed (a job run early by another app's clock does
 * nothing; the sweep closes it once due).
 */
export const awayCloseDue = (since: Date, at: Date, minuteMs: number): boolean =>
    at >= dueAt(since, AWAY_MINUTES, minuteMs)

/**
 * The end of a session by itself (`empty`, `study_disabled`,
 * `channel_deleted`), at `at`: the phase ends it missed first (caughtUp),
 * so no focus second is lost. Null when it has ended already.
 */
export const selfEndMove = (
    session: FocusSession,
    at: Date,
    minuteMs: number,
    reason: EndReason
): SessionMove | null =>
    session.status === 'ended'
        ? null
        : caughtUp(session, at, minuteMs, (current, now) => stopMove(current, now, reason))

/**
 * The end of a room empty since `since` (D-227): only while it is still
 * empty since then (someone came in, or it went empty again later: another
 * timer), and once EMPTY_MINUTES have passed (a job run early by another
 * app's clock does nothing; the sweep ends it once due).
 */
export function emptyEndMove(session: FocusSession, since: Date, at: Date, minuteMs: number): SessionMove | null {
    if (session.emptySince?.getTime() !== since.getTime()) return null
    if (at < dueAt(since, EMPTY_MINUTES, minuteMs)) return null
    return selfEndMove(session, at, minuteMs, 'empty')
}
