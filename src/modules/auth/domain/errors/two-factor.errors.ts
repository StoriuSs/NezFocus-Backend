import { DomainError } from '@/shared/domain/domain-error'

/**
 * The first step of signing in is done, and the account has two-step sign-in:
 * send a code from the authenticator app, with this challenge, to
 * POST /auth/login/2fa. Not a failure — the client moves to the next screen.
 */
export class TwoFactorRequiredError extends DomainError {
    readonly kind = 'forbidden'
    readonly errorKey = 'AUTH_TWO_FACTOR_REQUIRED'
    readonly details: { challenge: string }
    constructor(challenge: string) {
        super('Enter the code from your authenticator app.')
        this.details = { challenge }
    }
}

export class TwoFactorCodeInvalidError extends DomainError {
    readonly kind = 'invalid'
    readonly errorKey = 'AUTH_TWO_FACTOR_CODE_INVALID'
    readonly details?: { attemptsLeft: number }
    constructor(attemptsLeft?: number) {
        super('That code is not right. Check the app and try again.')
        if (attemptsLeft !== undefined) this.details = { attemptsLeft }
    }
}

/** Too long, too many wrong codes, or already used: the sign-in starts over. */
export class TwoFactorChallengeExpiredError extends DomainError {
    readonly kind = 'unauthenticated'
    readonly errorKey = 'AUTH_TWO_FACTOR_CHALLENGE_EXPIRED'
    constructor() {
        super('This sign-in has expired. Sign in again.')
    }
}

export class TwoFactorAlreadyOnError extends DomainError {
    readonly kind = 'conflict'
    readonly errorKey = 'AUTH_TWO_FACTOR_ALREADY_ON'
    constructor() {
        super('Two-step verification is already on.')
    }
}

export class TwoFactorNotOnError extends DomainError {
    readonly kind = 'conflict'
    readonly errorKey = 'AUTH_TWO_FACTOR_NOT_ON'
    constructor(message = 'Two-step verification is not on.') {
        super(message)
    }
}

/**
 * The account's two-step secret was sealed with an encryption key this server
 * does not have (AUTH_ENCRYPTION_KEY changed or lost), so no code can be
 * checked. Refused rather than let through: the person gets a clear answer,
 * and the operator a log line saying what to do.
 */
export class TwoFactorUnavailableError extends DomainError {
    readonly kind = 'unavailable'
    readonly errorKey = 'AUTH_TWO_FACTOR_UNAVAILABLE'
    constructor() {
        super("Two-step verification can't be checked for this account right now. Contact support.")
    }
}
