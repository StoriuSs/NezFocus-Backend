import { DomainError } from '@/shared/domain/domain-error'
import { PASSWORD_RULE_MESSAGES, PasswordRule } from '../password-policy'

/** `data.rules` names each broken rule, so a form can mark them one by one. */
export class PasswordRejectedError extends DomainError {
    readonly kind = 'unprocessable'
    readonly errorKey = 'AUTH_PASSWORD_REJECTED'
    readonly details: { rules: PasswordRule[] }
    constructor(public readonly rules: PasswordRule[]) {
        super(rules.map((rule) => PASSWORD_RULE_MESSAGES[rule]).join(' '))
        this.details = { rules }
    }
}

export class CurrentPasswordInvalidError extends DomainError {
    readonly kind = 'invalid'
    readonly errorKey = 'AUTH_CURRENT_PASSWORD_INVALID'
    constructor() {
        super('Your current password is not right.')
    }
}

/** Setting a first password, for an account that has one: change it instead. */
export class PasswordAlreadySetError extends DomainError {
    readonly kind = 'conflict'
    readonly errorKey = 'AUTH_PASSWORD_ALREADY_SET'
    constructor() {
        super('This account already has a password. Change it instead.')
    }
}
