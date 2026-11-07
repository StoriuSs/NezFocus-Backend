import { DomainError } from './domain-error'

/**
 * The limits could not be counted (Redis is unreachable), so the request is
 * refused rather than let through uncounted (D-137): those limits are what
 * stops guessing at codes and passwords.
 */
export class LimitsUnavailableError extends DomainError {
    readonly kind = 'unavailable'
    readonly errorKey = 'SERVICE_UNAVAILABLE'
    constructor() {
        super('Signing in is unavailable for a moment. Try again shortly.')
    }
}
