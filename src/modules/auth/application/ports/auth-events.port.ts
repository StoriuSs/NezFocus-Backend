/**
 * What happened, for metrics and alerts. A fixed set: each becomes a label
 * value on `auth_events_total`.
 */
export const AUTH_EVENT_NAMES = [
    'login_succeeded',
    'login_failed',
    'login_rate_limited',
    'refresh_reuse_detected',
    'password_reset',
    'password_set',
    'registration',
    'oauth_login_succeeded',
    'oauth_login_failed',
    'oauth_account_linked',
    'two_factor_enabled',
    'two_factor_disabled',
    'recovery_codes_replaced',
    'account_deleted',
    'two_factor_failed'
] as const

export type AuthEvent = (typeof AUTH_EVENT_NAMES)[number]

/** Who an event concerns, when it is a security incident someone may follow up. */
export interface AuthEventSubject {
    userId: string
    sessionId?: string
}

export interface AuthEventsPort {
    record(event: AuthEvent, subject?: AuthEventSubject): void
}

export const AUTH_EVENTS = Symbol('AuthEventsPort')
