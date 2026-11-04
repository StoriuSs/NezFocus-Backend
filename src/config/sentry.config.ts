import type { ErrorEvent, NodeOptions } from '@sentry/nestjs'
import { REDACTED, isSensitiveKey, redactQuery, redactUrl } from '../shared/constants/sensitive-fields'

/**
 * Error tracking (Sentry, or anything that speaks its protocol: GlitchTip).
 * See docs/error-tracking.md.
 *
 * Off unless SENTRY_DSN is set: no DSN, no SDK client, and every report is a
 * no-op. Read from process.env rather than ConfigService because the SDK must
 * start before the app's modules are imported (src/instrument.ts); the same
 * variables are validated with the rest of the configuration at boot.
 */
export function sentryOptions(env: NodeJS.ProcessEnv = process.env): NodeOptions | null {
    const dsn = env.SENTRY_DSN?.trim()
    // Tests never report, whatever the developer's env file says.
    if (!dsn || env.NODE_ENV === 'test') return null

    const tracesSampleRate = Number(env.SENTRY_TRACES_SAMPLE_RATE)
    return {
        dsn,
        // The same name as the `environment` label on alerts and dashboards.
        environment: env.NODE_ENV || 'development',
        // deploy.sh's release tag (the commit), so an issue shows which deploy
        // introduced it. Unset outside deploy.sh.
        release: env.SENTRY_RELEASE || undefined,
        // No IP addresses or cookies. The user is attached as an id only.
        sendDefaultPii: false,
        // Errors only by default. Leaving the option out, rather than 0,
        // keeps the tracing machinery off entirely.
        ...(tracesSampleRate > 0 && tracesSampleRate <= 1 && { tracesSampleRate }),
        // Never the values of local variables (a token, a password) in stack frames.
        includeLocalVariables: false,
        integrations: withoutNestIntegration,
        beforeSend: scrubEvent,
        beforeBreadcrumb: (breadcrumb) => ({ ...breadcrumb, data: redactDeep(breadcrumb.data) })
    }
}

/** The name of the SDK's NestJS integration among its defaults. */
export const NEST_INTEGRATION = 'Nest'

/**
 * The SDK's defaults, without its NestJS integration.
 *
 * That integration reports a BullMQ processor's error on every attempt,
 * retries included (a job retried ten times through an outage: ten events),
 * and the SDK then ignores any later report of the same error object, so the
 * one that matters, when the job has failed for good (QueueFailureReporter),
 * was never sent. Beyond that it only adds spans for tracing and reports for
 * @Cron and @OnEvent handlers, which the app has none of. Request errors are
 * reported by GlobalExceptionFilter either way.
 */
export function withoutNestIntegration<T extends { name: string }>(defaults: T[]): T[] {
    return defaults.filter((integration) => integration.name !== NEST_INTEGRATION)
}

/**
 * Removes credentials from an event before it leaves the process: headers,
 * cookies, body and query fields, extra data and breadcrumbs whose key is on
 * the shared sensitive list (the same one pino redacts).
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
    if (event.request) {
        const { request } = event
        request.headers = redactDeep(request.headers)
        request.data = typeof request.data === 'string' ? redactBody(request.data) : redactDeep(request.data)
        // Cookies are sessions; none of them are worth sending.
        if (request.cookies) request.cookies = {}
        if (typeof request.query_string === 'string') {
            request.query_string = redactQuery(request.query_string)
        } else {
            request.query_string = redactDeep(request.query_string)
        }
        if (request.url) request.url = redactUrl(request.url)
    }
    event.extra = redactDeep(event.extra)
    event.contexts = redactDeep(event.contexts)
    event.breadcrumbs = event.breadcrumbs?.map((breadcrumb) => ({ ...breadcrumb, data: redactDeep(breadcrumb.data) }))
    return event
}

const MAX_DEPTH = 10

/** A copy with every sensitive key's value replaced. Cycles and deep nesting are cut. */
export function redactDeep<T>(value: T, depth = 0, seen = new WeakSet<object>()): T {
    if (value === null || typeof value !== 'object') {
        return typeof value === 'string' ? (redactQueryInString(value) as T) : value
    }
    if (seen.has(value) || depth >= MAX_DEPTH) return '[Truncated]' as T
    // The objects on the current path only: one referenced twice is not a cycle.
    seen.add(value)
    let copy: unknown
    if (Array.isArray(value)) {
        copy = value.map((item) => redactDeep(item, depth + 1, seen))
    } else {
        const entries = Object.entries(value).map(([key, item]) => [
            key,
            isSensitiveKey(key) ? REDACTED : redactDeep(item, depth + 1, seen)
        ])
        copy = Object.fromEntries(entries)
    }
    seen.delete(value)
    return copy as T
}

/**
 * The SDK sends the request body as the raw text it received, not as an
 * object, so the keys inside have to be found by parsing it: JSON, or a form.
 */
export function redactBody(body: string): string {
    const text = body.trim()
    if (text.startsWith('{') || text.startsWith('[')) {
        try {
            return JSON.stringify(redactDeep(JSON.parse(text) as unknown))
        } catch {
            // Not JSON after all (truncated, or malformed: a 400 either way).
            // Nothing can be told apart in it, so none of it is sent.
            return REDACTED
        }
    }
    return /^[^\s=&]+=/.test(text) ? redactQuery(text) : body
}

/** URLs inside free text (a breadcrumb's `url`, an error message). */
function redactQueryInString(text: string): string {
    return text.includes('?') && text.includes('=')
        ? text.replace(/\?[^\s#"']*/g, (match) => `?${redactQuery(match.slice(1))}`)
        : text
}
