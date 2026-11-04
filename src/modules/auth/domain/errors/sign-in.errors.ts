import { DomainError } from '@/shared/domain/domain-error'

/**
 * Wrong password, or no such account. Deliberately one error for both.
 * `captchaRequired`: the next attempt must come with a Turnstile token.
 */
export class InvalidCredentialsError extends DomainError {
    readonly kind = 'unauthenticated'
    readonly errorKey = 'AUTH_INVALID_CREDENTIALS'
    readonly details?: { captchaRequired: true }
    constructor(captchaRequired = false) {
        super('Incorrect email or password.')
        if (captchaRequired) this.details = { captchaRequired: true }
    }
}

/** The password was right, but the address has not been confirmed yet. */
export class EmailNotVerifiedError extends DomainError {
    readonly kind = 'forbidden'
    readonly errorKey = 'AUTH_EMAIL_NOT_VERIFIED'
    constructor() {
        super('Confirm your email address before signing in. We can send you a new code.')
    }
}

export class AccountDisabledError extends DomainError {
    readonly kind = 'forbidden'
    readonly errorKey = 'AUTH_ACCOUNT_DISABLED'
    constructor() {
        super('This account has been deleted.')
    }
}

/** A cookie-authenticated request from a site this API does not serve. */
export class OriginNotAllowedError extends DomainError {
    readonly kind = 'forbidden'
    readonly errorKey = 'AUTH_FORBIDDEN'
    constructor() {
        super('This request did not come from an allowed site.')
    }
}
