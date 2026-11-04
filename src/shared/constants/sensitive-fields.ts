/**
 * Field names whose values must never leave the process.
 *
 * One list, because there is more than one way out: the logs (pino redacts
 * these paths, see config/pino.config.ts) and error tracking (the Sentry event
 * is scrubbed of these keys, see config/sentry.config.ts). Adding a secret to
 * one list and forgetting the other is how a credential ends up in a log
 * aggregator or a third-party error tracker.
 */

/** Request headers that carry credentials or session material. */
export const SENSITIVE_REQUEST_HEADERS = [
    'authorization',
    'proxy-authorization',
    'cookie',
    'x-api-key',
    // An idempotency key identifies a caller's operation and can be replayed,
    // so it is a capability rather than a trace id.
    'idempotency-key'
] as const

export const SENSITIVE_RESPONSE_HEADERS = ['set-cookie'] as const

/**
 * Body fields and query parameters. Compared without case, `-` or `_` where
 * the shape is unknown (Sentry), and listed in both spellings for the log's
 * fixed paths: a request body arrives snake_case, the app's objects are
 * camelCase.
 */
export const SENSITIVE_BODY_FIELDS = [
    'password',
    'confirmPassword',
    'oldPassword',
    'newPassword',
    'currentPassword',
    'token',
    'refreshToken',
    'accessToken',
    // Emailed codes, two-step codes and recovery codes: each signs in, or
    // proves the right to change the account. (A generic name: an error's
    // `code` in Sentry's extra data is masked too. Its message still says it.)
    'code',
    'twoFactorCode',
    'recoveryCodes',
    // The halfway point of a two-step sign-in, and the authenticator secret.
    'challenge',
    'secret',
    'otpauthUri',
    'turnstileToken',
    // Google's return: the one-time code is above; the state ties it to a browser.
    'state'
] as const

export const REDACTED = '[REDACTED]'

function normaliseKey(key: string): string {
    return key.toLowerCase().replace(/[-_]/g, '')
}

const SENSITIVE_KEYS = new Set(
    [...SENSITIVE_REQUEST_HEADERS, ...SENSITIVE_RESPONSE_HEADERS, ...SENSITIVE_BODY_FIELDS].map(normaliseKey)
)

/**
 * Whether a key names something sensitive, for walking a structure whose shape
 * is not known in advance (a Sentry event's request, extra data and
 * breadcrumbs). Compared without case, `-` or `_`, so `Access-Token`,
 * `access_token` and `accessToken` are all caught.
 */
export function isSensitiveKey(key: string): boolean {
    return SENSITIVE_KEYS.has(normaliseKey(key))
}

/** A query string with every sensitive parameter's value replaced. */
export function redactQuery(query: string): string {
    const params = new URLSearchParams(query)
    let changed = false
    for (const key of [...params.keys()]) {
        if (isSensitiveKey(key)) {
            params.set(key, REDACTED)
            changed = true
        }
    }
    return changed ? params.toString() : query
}

/**
 * A request URL safe to log: Google's return to /auth/google/callback carries
 * a one-time `code` and the `state` in its query, and a log line keeps it
 * for weeks.
 */
export function redactUrl(url: string): string {
    const index = url.indexOf('?')
    return index === -1 ? url : url.slice(0, index + 1) + redactQuery(url.slice(index + 1))
}
