import { DomainError } from '@/shared/domain/domain-error'

/** Thrown when a user lookup returns no live user. */
export class UserNotFoundError extends DomainError {
    readonly kind = 'not_found'
    readonly errorKey = 'USER_NOT_FOUND'

    constructor(public readonly identifier: string) {
        super(`User not found: ${identifier}`)
    }
}
