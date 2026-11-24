import { DomainError } from '@/shared/domain/domain-error'

/**
 * No one to befriend or block by that id or username: none such, an account
 * not completed, deleted or waiting to be (D-182, D-243), or oneself
 * (D-242). The same answer for all.
 */
export class PersonNotFoundError extends DomainError {
    readonly kind = 'not_found'
    readonly errorKey = 'NOT_FOUND'

    constructor(who: string) {
        super(`Person not found: ${who}`)
    }
}

/** More than 30 username lookups in a minute (D-110, D-242): 429 with `data.reason = "user_lookup"`. */
export class UserLookupLimitError extends DomainError {
    readonly kind = 'rate_limited'
    readonly errorKey = 'RATE_LIMIT_EXCEEDED'
    readonly details = { reason: 'user_lookup' }

    constructor(readonly retryAfterSeconds: number) {
        super(`Too many username lookups. Try again in ${retryAfterSeconds} seconds.`)
    }
}
