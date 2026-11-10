import { DomainError } from '@/shared/domain/domain-error'
import { MAX_SERVERS_PER_USER } from '../server-limit.rules'

/** Already in 100 servers: leave one before creating or joining another. */
export class MaxServersReachedError extends DomainError {
    readonly kind = 'forbidden'
    readonly errorKey = 'MAX_SERVERS_REACHED'

    constructor() {
        super(`Already in ${MAX_SERVERS_PER_USER} servers`)
    }
}

/**
 * No such server, deleted, or not one they are in: the same answer for all
 * three, so a stranger learns nothing from an id (NFR-SEC-05).
 */
export class ServerNotFoundError extends DomainError {
    readonly kind = 'not_found'
    readonly errorKey = 'NOT_FOUND'

    constructor(serverId: string) {
        super(`Server not found: ${serverId}`)
    }
}

/** A member of the server, without the permission this needs. */
export class MissingPermissionError extends DomainError {
    readonly kind = 'forbidden'
    readonly errorKey = 'FORBIDDEN'

    constructor(permission: string) {
        super(`Missing permission: ${permission}`)
    }
}

/** Someone named is not (or no longer) a member of the server. */
export class MemberNotFoundError extends DomainError {
    readonly kind = 'not_found'
    readonly errorKey = 'NOT_FOUND'

    constructor(userId: string) {
        super(`Member not found: ${userId}`)
    }
}
