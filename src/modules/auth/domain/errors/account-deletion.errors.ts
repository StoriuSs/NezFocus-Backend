import { DomainError } from '@/shared/domain/domain-error'

/**
 * Deleting an account needs proof it is the owner, and none was sent:
 * `data.needs` lists what (the password). An account without a password
 * chooses one with "forgot password" first.
 */
export class ConfirmationRequiredError extends DomainError {
    readonly kind = 'invalid'
    readonly errorKey = 'AUTH_CONFIRMATION_REQUIRED'
    readonly details: { needs: 'password'[] }
    constructor(needs: 'password'[]) {
        super('Confirm it is you first.')
        this.details = { needs }
    }
}
