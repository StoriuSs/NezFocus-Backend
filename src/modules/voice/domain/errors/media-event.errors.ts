import { DomainError } from '@/shared/domain/domain-error'

/**
 * A webhook not signed by our media server, or whose body is not the one it
 * signed (D-210): nothing in it is taken.
 */
export class MediaEventRejectedError extends DomainError {
    readonly kind = 'unauthenticated'
    readonly errorKey = 'AUTH_UNAUTHORIZED'

    constructor(reason: string) {
        super(`Media event rejected: ${reason}`)
    }
}
