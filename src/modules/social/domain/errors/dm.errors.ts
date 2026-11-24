import { DomainError } from '@/shared/domain/domain-error'

/** No such DM of the person's: none by that id, or someone else's (NFR-SEC-05). The same answer for both. */
export class DmNotFoundError extends DomainError {
    readonly kind = 'not_found'
    readonly errorKey = 'NOT_FOUND'

    constructor(channelId: string) {
        super(`Direct message not found: ${channelId}`)
    }
}
