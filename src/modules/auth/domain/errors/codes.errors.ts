import { DomainError } from '@/shared/domain/domain-error'

export class CodeInvalidError extends DomainError {
    readonly kind = 'invalid'
    readonly errorKey = 'AUTH_CODE_INVALID'
    constructor(message = 'That code is not right. If you asked for more than one, only the newest works.') {
        super(message)
    }
}

/** Expired, or out of attempts: either way, a new code has to be sent, and the message says both. */
export class CodeExpiredError extends DomainError {
    readonly kind = 'invalid'
    readonly errorKey = 'AUTH_CODE_EXPIRED'
    constructor() {
        super('This code no longer works: it expired, or had too many wrong tries. Ask for a new one.')
    }
}
