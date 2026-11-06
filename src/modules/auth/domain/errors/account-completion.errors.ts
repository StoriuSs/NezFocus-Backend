import { DomainError } from '@/shared/domain/domain-error'

/**
 * A signed-in route used before the "complete your account" step (D-61). Not
 * a 401: the session is fine, and clients sign out on any 401; this one
 * sends the person to /welcome.
 */
export class AccountIncompleteError extends DomainError {
    readonly kind = 'forbidden'
    readonly errorKey = 'ACCOUNT_INCOMPLETE'
    constructor() {
        super('Complete your account first.')
    }
}

/** The "complete your account" step, sent again once it is done. */
export class AccountAlreadyCompleteError extends DomainError {
    readonly kind = 'conflict'
    readonly errorKey = 'ACCOUNT_ALREADY_COMPLETE'
    constructor() {
        super('This account is already complete.')
    }
}
