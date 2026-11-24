import { DomainError } from '@/shared/domain/domain-error'

/** No such call of the person's: none by that id, or one of two others (NFR-SEC-05). The same answer for both. */
export class CallNotFoundError extends DomainError {
    readonly kind = 'not_found'
    readonly errorKey = 'NOT_FOUND'

    constructor(callId: string) {
        super(`Call not found: ${callId}`)
    }
}

/** Calling while making or in another call (D-245): a tab whose state is behind. */
export class CallInProgressError extends DomainError {
    readonly kind = 'conflict'
    readonly errorKey = 'CALL_IN_PROGRESS'

    constructor(userId: string) {
        super(`User ${userId} is already in a call`)
    }
}
