import { DomainError } from '@/shared/domain/domain-error'

/**
 * Deleting an account needs proof it is the owner, and some was not sent:
 * `data.needs` lists what this account needs (`password`, `code` — the
 * emailed one, for an account without a password).
 */
export class ConfirmationRequiredError extends DomainError {
    readonly kind = 'invalid'
    readonly errorKey = 'AUTH_CONFIRMATION_REQUIRED'
    readonly details: { needs: ('password' | 'code')[] }
    constructor(needs: ('password' | 'code')[]) {
        super('Confirm it is you first.')
        this.details = { needs }
    }
}

/** An emailed code was asked for to confirm it is the owner, but the account has a password: that is the proof. */
export class UsePasswordError extends DomainError {
    readonly kind = 'conflict'
    readonly errorKey = 'AUTH_USE_PASSWORD'
    constructor() {
        super('This account has a password: confirm with it instead.')
    }
}
