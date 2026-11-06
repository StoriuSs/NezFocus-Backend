import { DomainError } from '@/shared/domain/domain-error'

/** Wrong password, or no such account. Deliberately one error for both. */
export class InvalidCredentialsError extends DomainError {
    readonly kind = 'unauthenticated'
    readonly errorKey = 'AUTH_INVALID_CREDENTIALS'
    constructor() {
        super('Incorrect email or password.')
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
