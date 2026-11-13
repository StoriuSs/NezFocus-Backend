import { DomainError } from '@/shared/domain/domain-error'

/**
 * A socket offered no ticket, a made-up one, one already spent or one out of
 * time. The client buys a new one and connects again.
 */
export class TicketInvalidError extends DomainError {
    readonly kind = 'unauthenticated'
    readonly errorKey = 'REALTIME_TICKET_INVALID'
    constructor() {
        super('This realtime ticket is not valid. Ask for a new one.')
    }
}

/** Tickets are kept in Redis; while it cannot be reached, none can be bought. */
export class TicketsUnavailableError extends DomainError {
    readonly kind = 'unavailable'
    readonly errorKey = 'SERVICE_UNAVAILABLE'
    constructor() {
        super('Live updates are unavailable for a moment. Try again shortly.')
    }
}
