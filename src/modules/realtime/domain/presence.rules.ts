/** The status a person chooses in their menu (D-78), kept in their settings (users' ChosenPresence). */
export type ChosenStatus = 'online' | 'idle' | 'dnd' | 'invisible'

/** What other people see of someone (REQ-AUTH-07): invisible shows as offline. */
export const PRESENCES = ['online', 'idle', 'dnd', 'offline'] as const
export type Presence = (typeof PRESENCES)[number]

/** One tab's socket, as presence keeps it. */
export interface SocketPresence {
    /** The tab said it has gone unused for 10 minutes. */
    idle: boolean
    /** When it was last heard from (connect, heartbeat, a signal), in ms. */
    seenAt: number
}

/**
 * How long a person, or one tab of theirs, may go unheard before counting
 * as gone (REQ-AUTH-07): every tab disconnected this long is offline. A tab
 * sends a heartbeat every 30 seconds (ARCHITECTURE 3.3), so one alive is
 * heard twice in that time.
 */
export const SILENCE_MS = 60_000

/** The sockets still alive: heard from within SILENCE_MS. One silent longer was on an app instance that went without saying. */
export function liveSockets(sockets: SocketPresence[], now: number): SocketPresence[] {
    return sockets.filter((socket) => now - socket.seenAt <= SILENCE_MS)
}

/**
 * What other people see of a person (REQ-AUTH-07), from the status they
 * chose and their live tabs:
 * - no tab: what was shown is kept for SILENCE_MS after the last was heard
 *   (a page reload does not flash offline), offline after that;
 * - invisible shows as offline; do not disturb and away show as chosen,
 *   whatever the tabs do (away does not override do not disturb);
 * - online turns away once every tab says it has gone unused, the tabs
 *   counted together.
 */
export function shownPresence(input: {
    chosen: ChosenStatus
    sockets: SocketPresence[]
    /** What others see now. */
    held: Presence
    /** When the person was last heard from, by any tab, in ms. */
    lastSeenAt: number
    now: number
}): Presence {
    const { chosen, sockets, held, lastSeenAt, now } = input
    if (sockets.length === 0) return now - lastSeenAt > SILENCE_MS ? 'offline' : held
    if (chosen === 'invisible') return 'offline'
    if (chosen !== 'online') return chosen
    return sockets.every((socket) => socket.idle) ? 'idle' : 'online'
}
