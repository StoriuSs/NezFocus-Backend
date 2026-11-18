import { DomainError } from '@/shared/domain/domain-error'

/**
 * LiveKit did not answer, or answered with an error of its own. Nothing was
 * changed; the person tries again shortly.
 */
export class MediaRoomsUnavailableError extends DomainError {
    readonly kind = 'unavailable'
    readonly errorKey = 'SERVICE_UNAVAILABLE'
    constructor() {
        super('Voice rooms are unavailable for a moment. Try again shortly.')
    }
}
