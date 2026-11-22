import { DomainError } from '@/shared/domain/domain-error'

/**
 * The history paged after a session that is not one of the person's (D-230):
 * the client starts again from the first page (CONFLICT_ERROR), as for tasks
 * (D-97).
 */
export class StaleStudyCursorError extends DomainError {
    readonly kind = 'conflict'
    readonly errorKey = 'CONFLICT'

    constructor(sessionId: string) {
        super(`Study history cursor no longer holds: ${sessionId}`)
    }
}
