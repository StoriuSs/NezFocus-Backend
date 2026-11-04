import { DomainError } from '@/shared/domain/domain-error'

/**
 * Thrown when attempting to set a username that is already in use.
 * The repository adapter translates ORM-specific constraint violations into this.
 */
export class UsernameTakenError extends DomainError {
    readonly kind = 'conflict'
    readonly errorKey = 'USERNAME_CONFLICT'

    constructor(public readonly username: string) {
        super(`Username already taken: ${username}`)
    }
}

/** Thrown when a user tries to set their username a second time (it is set once). */
export class UsernameAlreadySetError extends DomainError {
    readonly kind = 'invalid'
    readonly errorKey = 'USERNAME_ALREADY_SET'

    constructor() {
        super('Username has already been set and cannot be changed')
    }
}
