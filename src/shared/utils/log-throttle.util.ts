/**
 * How often a repeating error is logged: a dependency outage produces the same
 * failure on every request or retry, and once a minute is enough to see it
 * continues.
 */
export const REPEATED_ERROR_LOG_INTERVAL_MS = 60_000

/**
 * Logs a repeating error once per interval instead of every time.
 *
 * A dropped connection retries every few seconds and fails the same way each
 * time: one line per attempt buries everything else in the logs. The first
 * error is logged at once; repeats within `intervalMs` are counted, and the
 * next message says how many there were.
 *
 * @example
 * const log = throttledLog((message) => logger.error(message), 60_000)
 * client.on('error', (error) => log(`Redis client error: ${error.message}`))
 */
export function throttledLog(write: (message: string) => void, intervalMs: number, now: () => number = Date.now) {
    let lastWritten: number | undefined
    let suppressed = 0
    return (message: string) => {
        const time = now()
        if (lastWritten !== undefined && time - lastWritten < intervalMs) {
            suppressed++
            return
        }
        write(
            suppressed > 0
                ? `${message} (repeated ${suppressed} more time${suppressed === 1 ? '' : 's'} since the last message)`
                : message
        )
        lastWritten = time
        suppressed = 0
    }
}
