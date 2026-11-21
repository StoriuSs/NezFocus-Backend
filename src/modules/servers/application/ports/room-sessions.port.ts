/**
 * A voice room's study session not yet ended (D-220), as `focus_session.*`
 * sends it too: where it is, so the client counts down from phaseEndsAt
 * with the offset of serverTime (D-18, D-222).
 */
export interface RoomSession {
    id: string
    /** Null when nobody in the room may start a session (REQ-STUDY-03). */
    hostId: string | null
    /** The cycle, in minutes; both long-break halves set, or neither. */
    focusMinutes: number
    shortBreakMinutes: number
    longBreakMinutes: number | null
    longBreakEvery: number | null
    /** Running or paused: a room's session never waits, and an ended one is not listed. */
    status: 'running' | 'paused' | 'waiting' | 'ended'
    phase: 'focus' | 'short_break' | 'long_break'
    phaseIndex: number
    phaseStartedAt: Date
    /** While running. */
    phaseEndsAt: Date | null
    /** While paused. */
    pausedRemainingMs: number | null
    /** When the focus stretch running now began: the client adds the time after it to today's minutes (D-224). */
    stretchStartedAt: Date | null
    startedAt: Date
    version: number
    /** The server's clock when this was read. */
    serverTime: Date
}

/**
 * Room Sessions Port — the study session of each voice room, for the rooms
 * in `GET /servers` (D-220). Kept by the study module, which imports this
 * module: study answers this port through a small global module (as D-180,
 * D-205), so the code depends one way only.
 */
export interface RoomSessionsPort {
    /** The session not yet ended of each room asked for that has one. The caller has decided the rooms may be shown. */
    sessionsOf(channelIds: string[]): Promise<Map<string, RoomSession>>
}

export const ROOM_SESSIONS = Symbol('RoomSessionsPort')
