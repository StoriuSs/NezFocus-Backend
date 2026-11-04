import * as Sentry from '@sentry/nestjs'

export interface ErrorReportContext {
    /** Ties the issue to its log line: search Loki for the same requestId. */
    requestId?: string
    /** The user's id only: no email or name leaves the process. */
    userId?: string
    method?: string
    /** The route pattern (`/users/:id`), not the URL, so issues group by route. */
    route?: string
    statusCode?: number
    /** Anything that narrows an issue down, as searchable tags. */
    tags?: Record<string, string | number | undefined>
    /** Detail shown on the event, not searchable. Scrubbed like the rest. */
    extra?: Record<string, unknown>
}

/**
 * How many events one error (same type, message and route) may send. An
 * outage turns every request into the same 500, for as long as it lasts: a
 * night of it at even 10 events a minute would spend a month of a free plan's
 * quota on one issue. So each error gets a burst of ERROR_REPORT_BURST events,
 * then one more every ERROR_REPORT_REFILL_MS: about 90 over eight hours. Loki
 * still has every occurrence.
 */
export const ERROR_REPORT_BURST = 10
export const ERROR_REPORT_REFILL_MS = 6 * 60_000
/** Distinct errors remembered at once; a new one beyond it is dropped. */
export const MAX_TRACKED_ERRORS = 500

interface Bucket {
    tokens: number
    refilledAt: number
}

const buckets = new Map<string, Bucket>()

function refill(bucket: Bucket, now: number): void {
    const due = Math.floor((now - bucket.refilledAt) / ERROR_REPORT_REFILL_MS)
    if (due <= 0) return
    bucket.tokens = Math.min(ERROR_REPORT_BURST, bucket.tokens + due)
    bucket.refilledAt += due * ERROR_REPORT_REFILL_MS
}

/** Forgets errors whose allowance is whole again: remembering them changes nothing. */
function forgetRefilled(now: number): void {
    for (const [key, bucket] of buckets) {
        refill(bucket, now)
        if (bucket.tokens >= ERROR_REPORT_BURST) buckets.delete(key)
    }
}

/** Whether this error may send another event now; uses up one if so. */
export function withinReportLimit(key: string, now = Date.now()): boolean {
    let bucket = buckets.get(key)
    if (bucket) {
        refill(bucket, now)
    } else {
        if (buckets.size >= MAX_TRACKED_ERRORS) forgetRefilled(now)
        if (buckets.size >= MAX_TRACKED_ERRORS) return false
        bucket = { tokens: ERROR_REPORT_BURST, refilledAt: now }
        buckets.set(key, bucket)
    }
    if (bucket.tokens < 1) return false
    bucket.tokens -= 1
    return true
}

function errorKey(error: unknown, route: string | undefined): string {
    const { name, message } = error instanceof Error ? error : { name: typeof error, message: String(error) }
    return JSON.stringify([name, message, route ?? ''])
}

/**
 * Sends an unexpected error to error tracking (docs/error-tracking.md).
 *
 * Only for faults: a 5xx, a job that failed for good, a crash. A 4xx is the
 * client's mistake, and reporting it would bury real faults and spend the
 * quota. Does nothing when error tracking is off (no SENTRY_DSN).
 */
export function reportError(error: unknown, context: ErrorReportContext = {}): void {
    if (!Sentry.isInitialized()) return
    if (!withinReportLimit(errorKey(error, context.route))) return
    Sentry.withScope((scope) => {
        if (context.userId) scope.setUser({ id: context.userId })
        const tags = {
            request_id: context.requestId,
            method: context.method,
            route: context.route,
            status_code: context.statusCode,
            ...context.tags
        }
        for (const [key, value] of Object.entries(tags)) {
            if (value !== undefined && value !== '') scope.setTag(key, value)
        }
        if (context.extra) scope.setExtras(context.extra)
        Sentry.captureException(error)
    })
}
