import { DomainError } from '@/shared/domain/domain-error'

/**
 * No such code, used up, out of time, revoked, or its server deleted: one
 * answer for all, so a guess learns nothing more (REQ-SRV-03).
 */
export class InviteInvalidError extends DomainError {
    readonly kind = 'gone'
    readonly errorKey = 'INVITE_INVALID'

    constructor() {
        super('This invite is invalid or has expired')
    }
}

/** Banned from the server: no invite lets them back in (REQ-SRV-04, ROLE-04). */
export class BannedFromServerError extends DomainError {
    readonly kind = 'forbidden'
    readonly errorKey = 'BANNED_FROM_SERVER'

    constructor() {
        super('You cannot join this server')
    }
}

/**
 * Too many wrong invite codes from this network (REQ-SRV-03): `data.reason`
 * is `network`, as the auth limits counted per IP, so a page can say that
 * others on a shared network count too.
 */
export class InviteGuessesLimitedError extends DomainError {
    readonly kind = 'rate_limited'
    readonly errorKey = 'RATE_LIMIT_EXCEEDED'
    readonly details = { reason: 'network' }

    constructor(readonly retryAfterSeconds: number) {
        super(`Too many wrong invite codes from your network. Try again in ${retryAfterSeconds} seconds.`)
    }
}
