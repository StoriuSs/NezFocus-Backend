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
    'registration',
    'oauth_login_succeeded',
    'oauth_login_failed',
    'oauth_account_linked',
    // Asked to delete the account (D-141), taken back, and deleted by the
    // sweep 14 days later (accounts whose owner asked; not abandoned sign-ups).
    'account_deletion_requested',
    'account_restored',
    'account_deleted'
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
