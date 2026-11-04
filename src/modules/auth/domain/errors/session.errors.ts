import { DomainError } from '@/shared/domain/domain-error'

/**
 * Why a session ended, for the device that finds out: `data.reason` on the
 * 401. Only the holder of that session's token is told, and it no longer
 * works, so it gives nothing away.
 * - `signed_out`: signed out (this session)
 * - `signed_out_everywhere`: "sign out everywhere", on any device
 * - `password_changed`: the password was changed or reset
 * - `security`: its refresh token was used twice, so presumed stolen
 * - `account_deleted`: the account was deleted
 * - `expired`: it reached the end of its life
 */
export type SessionEndReason =
    | 'signed_out'
    | 'signed_out_everywhere'
    | 'password_changed'
    | 'security'
    | 'account_deleted'
    | 'expired'

/** The refresh cookie is missing, unknown, expired, or its session has ended. */
export class RefreshFailedError extends DomainError {
    readonly kind = 'unauthenticated'
    readonly errorKey = 'AUTH_REFRESH_FAILED'
    readonly details?: { reason: SessionEndReason }
    constructor(reason?: SessionEndReason) {
        super('Your session has ended. Sign in again.')
        if (reason) this.details = { reason }
    }
}

export class TokenMissingError extends DomainError {
    readonly kind = 'unauthenticated'
    readonly errorKey = 'AUTH_TOKEN_MISSING'
    constructor() {
        super('Sign in to continue.')
    }
}

export class TokenExpiredError extends DomainError {
    readonly kind = 'unauthenticated'
    readonly errorKey = 'AUTH_TOKEN_EXPIRED'
    constructor() {
        super('Your access token has expired.')
    }
}

export class TokenInvalidError extends DomainError {
    readonly kind = 'unauthenticated'
    readonly errorKey = 'AUTH_TOKEN_INVALID'
    constructor() {
        super('Your access token is not valid.')
    }
}

/** The token is genuine, but the session it belongs to has been ended. */
export class SessionRevokedError extends DomainError {
    readonly kind = 'unauthenticated'
    readonly errorKey = 'AUTH_TOKEN_REVOKED'
    readonly details?: { reason: SessionEndReason }
    constructor(reason?: SessionEndReason) {
        super('This session has ended. Sign in again.')
        if (reason) this.details = { reason }
    }
}
