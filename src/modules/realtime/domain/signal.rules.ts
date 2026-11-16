/**
 * How many signals one socket may send (heartbeat, presence.idle,
 * typing.start, any other): SIGNALS_PER_WINDOW in any SIGNAL_WINDOW_MS. The
 * HTTP rate limiter never sees a socket's packets, and each signal costs
 * Redis, some SQL too; a tab sends a heartbeat every 30 seconds and a few
 * typing signals, far below this.
 */
export const SIGNALS_PER_WINDOW = 30
export const SIGNAL_WINDOW_MS = 10_000

/**
 * Whether a socket's next signal is taken, given when it sent the ones taken
 * before (in ms), and those to keep for the next. The window slides: one is
 * taken once fewer than SIGNALS_PER_WINDOW were taken in the last
 * SIGNAL_WINDOW_MS. One refused is not counted, so a socket that slows down
 * is heard again a window after its burst.
 */
export function takeSignal(takenAt: readonly number[], now: number): { taken: boolean; takenAt: number[] } {
    const recent = takenAt.filter((at) => now - at < SIGNAL_WINDOW_MS)
    if (recent.length >= SIGNALS_PER_WINDOW) return { taken: false, takenAt: recent }
    return { taken: true, takenAt: [...recent, now] }
}
