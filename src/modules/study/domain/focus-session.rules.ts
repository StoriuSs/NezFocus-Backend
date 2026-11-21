/*
 * The state machine of a study session (ARCHITECTURE 5.1, D-222): what each
 * command and the end of a phase do to where a session is. Each move says
 * what the row becomes, and when the focus stretch closes and opens (D-216):
 * the repository writes it, counts the seconds of a closed stretch, and
 * raises the version.
 */

/** A session's cycle, in study minutes (D-223), each STUDY_MINUTE_MS long (D-221). */
export interface Cycle {
    focusMinutes: number
    shortBreakMinutes: number
    /** Both set, or neither: no long break. */
    longBreakMinutes: number | null
    longBreakEvery: number | null
}

export type SessionKind = 'room' | 'solo'
export type SessionStatus = 'running' | 'paused' | 'waiting' | 'ended'
export type FocusPhase = 'focus' | 'short_break' | 'long_break'
export type EndReason =
    | 'stopped'
    | 'empty'
    | 'study_disabled'
    | 'channel_deleted'
    | 'expired'
    | 'signed_out'
    | 'joined_room'

/** Where a session is: each state has its own time and only it (FocusSession_status_check). */
export interface SessionClock {
    status: SessionStatus
    phase: FocusPhase
    phaseIndex: number
    phaseStartedAt: Date
    /** While running: when the phase ends. */
    phaseEndsAt: Date | null
    /** While paused: what was left of the phase. */
    pausedRemainingMs: number | null
    /** While waiting (a Solo): when it ends by itself. */
    waitingUntil: Date | null
    endedAt: Date | null
    endedReason: EndReason | null
}

/** A session as the rules and the clients see it. */
export interface FocusSession extends SessionClock {
    id: string
    kind: SessionKind
    serverId: string | null
    channelId: string | null
    hostId: string | null
    /** A Solo's person. */
    userId: string | null
    cycle: Cycle
    version: number
    startedAt: Date
    /** When the focus stretch running now began; null when none runs (D-224: the client adds what is not counted yet). */
    stretchStartedAt: Date | null
}

/** A change to a session, made at `at`. */
export interface SessionMove {
    /** When it was made: the counts it makes count up to here. */
    at: Date
    clock: SessionClock
    cycle: Cycle
    /** The focus stretches it closes and opens (D-216), in order. */
    stretches: StretchChange[]
}

/** The running focus stretch closing at a time, or a new one opening. */
export type StretchChange = { close: Date } | { open: Date }

const changes = (close: Date | null, open: Date | null): StretchChange[] => [
    ...(close ? [{ close }] : []),
    ...(open ? [{ open }] : [])
]

/** Whether a move closes a focus stretch: then everyone in the session is counted (D-224). */
export const closesStretch = (move: SessionMove): boolean => move.stretches.some((change) => 'close' in change)

/** When the stretch open after a move began, from the one open before it; null when none is open. */
export const stretchAfter = (move: SessionMove, before: Date | null): Date | null =>
    move.stretches.reduce<Date | null>((open, change) => ('open' in change ? change.open : null), before)

/** What a command asks of a session (the routes of SRS 5.1). */
export type ControlAction = 'pause' | 'resume' | 'skip' | 'stop'

/** What made a session change, as the room is told it (`focus_session.*`, for the toasts of spec 07). */
export type SessionAction = 'start' | ControlAction | 'config' | 'phase_end'

const later = (at: Date, ms: number) => new Date(at.getTime() + ms)

/**
 * The phase at place `index` of a session from 0: focus at the even places;
 * the break after focus phase n is long when the cycle has long breaks and n
 * is a multiple of longBreakEvery, short otherwise. Worked out from the
 * cycle each time, so a changed cycle moves which break comes.
 */
export function phaseOf(index: number, cycle: Cycle): FocusPhase {
    if (index % 2 === 0) return 'focus'
    const focusDone = (index + 1) / 2
    const { longBreakMinutes, longBreakEvery } = cycle
    return longBreakMinutes !== null && longBreakEvery !== null && focusDone % longBreakEvery === 0
        ? 'long_break'
        : 'short_break'
}

/** How long a phase of the cycle lasts, in milliseconds. */
export function phaseMs(phase: FocusPhase, cycle: Cycle, minuteMs: number): number {
    const minutes =
        phase === 'focus'
            ? cycle.focusMinutes
            : phase === 'short_break'
              ? cycle.shortBreakMinutes
              : (cycle.longBreakMinutes ?? cycle.shortBreakMinutes)
    return minutes * minuteMs
}

const blank = { pausedRemainingMs: null, waitingUntil: null, endedAt: null, endedReason: null }

/** The clock of a session, and nothing else of it. */
const clockOf = (session: SessionClock): SessionClock => ({
    status: session.status,
    phase: session.phase,
    phaseIndex: session.phaseIndex,
    phaseStartedAt: session.phaseStartedAt,
    phaseEndsAt: session.phaseEndsAt,
    pausedRemainingMs: session.pausedRemainingMs,
    waitingUntil: session.waitingUntil,
    endedAt: session.endedAt,
    endedReason: session.endedReason
})

/** A session just started at `at`: running its first focus phase. */
export function firstClock(cycle: Cycle, at: Date, minuteMs: number): SessionClock {
    return {
        ...blank,
        status: 'running',
        phase: 'focus',
        phaseIndex: 0,
        phaseStartedAt: at,
        phaseEndsAt: later(at, phaseMs('focus', cycle, minuteMs))
    }
}

/**
 * The running focus stretch closes at `at`, but never past the end its phase
 * was due: a command that comes before the late phase job does not stretch
 * the phase (D-224).
 */
function closeAt(session: FocusSession, at: Date): Date | null {
    if (session.status !== 'running' || session.phase !== 'focus') return null
    const due = session.phaseEndsAt!
    return due < at ? due : at
}

/** Pause (REQ-STUDY-03): what is left of the phase is kept; nothing runs. Null when not running. */
export function pauseMove(session: FocusSession, at: Date): SessionMove | null {
    if (session.status !== 'running') return null
    return {
        at,
        cycle: session.cycle,
        clock: {
            ...clockOf(session),
            ...blank,
            status: 'paused',
            phaseEndsAt: null,
            pausedRemainingMs: Math.max(0, session.phaseEndsAt!.getTime() - at.getTime())
        },
        stretches: changes(closeAt(session, at), null)
    }
}

/** Resume: the phase runs again for what was left of it. Null when not paused. */
export function resumeMove(session: FocusSession, at: Date): SessionMove | null {
    if (session.status !== 'paused') return null
    return {
        at,
        cycle: session.cycle,
        clock: {
            ...clockOf(session),
            ...blank,
            status: 'running',
            phaseEndsAt: later(at, session.pausedRemainingMs!)
        },
        stretches: changes(null, session.phase === 'focus' ? at : null)
    }
}

/** The phase after the current one, begun at `start`; running, or paused for its whole length (REQ-STUDY-03). */
function nextPhase(session: FocusSession, start: Date, minuteMs: number, paused: boolean): SessionClock {
    const phaseIndex = session.phaseIndex + 1
    const phase = phaseOf(phaseIndex, session.cycle)
    const length = phaseMs(phase, session.cycle, minuteMs)
    return {
        ...clockOf(session),
        ...blank,
        phase,
        phaseIndex,
        phaseStartedAt: start,
        ...(paused
            ? { status: 'paused', phaseEndsAt: null, pausedRemainingMs: length }
            : { status: 'running', phaseEndsAt: later(start, length) })
    }
}

/**
 * Skip the phase: the next one begins now. Skipped while paused, the next
 * one stays paused, for its whole length (REQ-STUDY-03). Null when the
 * session neither runs nor is paused.
 */
export function skipMove(session: FocusSession, at: Date, minuteMs: number): SessionMove | null {
    if (session.status !== 'running' && session.status !== 'paused') return null
    const paused = session.status === 'paused'
    const clock = nextPhase(session, at, minuteMs, paused)
    return {
        at,
        cycle: session.cycle,
        clock,
        stretches: changes(closeAt(session, at), !paused && clock.phase === 'focus' ? at : null)
    }
}

/**
 * The end of the running phase, by its job (ARCHITECTURE 5.1): made at the
 * time the phase was due, not when the job runs, so the next phase begins on
 * time; a job late enough to find that one over too is followed by one with
 * no delay, and the session catches up a phase at a time (D-225). Null when
 * not running.
 */
export function phaseEndMove(session: FocusSession, minuteMs: number): SessionMove | null {
    if (session.status !== 'running') return null
    const at = session.phaseEndsAt!
    const clock = nextPhase(session, at, minuteMs, false)
    return {
        at,
        cycle: session.cycle,
        clock,
        stretches: changes(closeAt(session, at), clock.phase === 'focus' ? at : null)
    }
}

/** End the session for `reason` (stopped, or one of its own ends). Null when it has ended already. */
export function stopMove(session: FocusSession, at: Date, reason: EndReason): SessionMove | null {
    if (session.status === 'ended') return null
    return {
        at,
        cycle: session.cycle,
        clock: { ...clockOf(session), ...blank, status: 'ended', phaseEndsAt: null, endedAt: at, endedReason: reason },
        stretches: changes(closeAt(session, at), null)
    }
}

/**
 * A new cycle, only while paused (REQ-STUDY-03, D-50): the current phase
 * begins again at the new length and stays paused, the seconds counted so far
 * kept. The break it is is worked out again from the new cycle (phaseOf): a
 * long break becomes a short one in a cycle with none, and the other way.
 * Null when the session is not paused: the caller says why.
 */
export function cycleMove(session: FocusSession, cycle: Cycle, at: Date, minuteMs: number): SessionMove | null {
    if (session.status !== 'paused') return null
    const phase = phaseOf(session.phaseIndex, cycle)
    return {
        at,
        cycle,
        clock: {
            ...clockOf(session),
            ...blank,
            status: 'paused',
            phase,
            phaseStartedAt: at,
            phaseEndsAt: null,
            pausedRemainingMs: phaseMs(phase, cycle, minuteMs)
        },
        stretches: []
    }
}

/** How many phase ends one catch-up makes at most: a guard, far past any outage the sweep leaves. */
const MAX_CATCH_UP = 10_000

/**
 * A command made at `at` on a session whose running phase is over by then
 * (its job late or lost, D-225): the phase ends it missed are made first,
 * each when it was due (phaseEndMove), so the command acts on the phase the
 * room is really in and no focus second between is lost; then the command.
 * One move for both: one version, one count. Nothing missed: the command
 * alone. Null when neither changes anything.
 */
export function caughtUp(
    session: FocusSession,
    at: Date,
    minuteMs: number,
    command: (session: FocusSession, at: Date) => SessionMove | null
): SessionMove | null {
    let current = session
    const missed: StretchChange[] = []
    for (let i = 0; i < MAX_CATCH_UP && current.status === 'running' && current.phaseEndsAt! <= at; i++) {
        const end = phaseEndMove(current, minuteMs)!
        missed.push(...end.stretches)
        current = { ...current, ...end.clock, stretchStartedAt: stretchAfter(end, current.stretchStartedAt) }
    }
    const move = command(current, at)
    if (move) return { ...move, stretches: [...missed, ...move.stretches] }
    return missed.length > 0 || current !== session
        ? { at, clock: clockOf(current), cycle: current.cycle, stretches: missed }
        : null
}

/**
 * Who may do `action` to a Room Session (REQ-STUDY-03, D-222): its Host, or
 * one with MANAGE_STUDY_ROOMS, in the room or not. With no Host, anyone in
 * the room may resume a paused one, and only that (D-119).
 */
export function mayControl(
    session: Pick<FocusSession, 'hostId'>,
    userId: string,
    action: ControlAction | 'config',
    { managesStudyRooms, inRoom }: { managesStudyRooms: boolean; inRoom: boolean }
): boolean {
    if (managesStudyRooms || session.hostId === userId) return true
    return session.hostId === null && action === 'resume' && inRoom
}

/** Who may start a session in a study room: anyone in it, or only managers, as the room says (REQ-STUDY-01). */
export const mayStart = (starter: 'anyone' | 'managers', managesStudyRooms: boolean): boolean =>
    starter === 'anyone' || managesStudyRooms
