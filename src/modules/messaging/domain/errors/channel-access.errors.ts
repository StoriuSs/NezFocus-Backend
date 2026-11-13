import { DomainError } from '@/shared/domain/domain-error'

/**
 * No such text channel, its server is gone, the person is not a member, or
 * they may not view it: the same answer for all (NFR-SEC-05).
 */
export class ChannelNotFoundError extends DomainError {
    readonly kind = 'not_found'
    readonly errorKey = 'NOT_FOUND'

    constructor(channelId: string) {
        super(`Channel not found: ${channelId}`)
    }
}

/**
 * The person sees the channel but may not post in it: no SEND_MESSAGES, or
 * the channel is for managers only (REQ-ROLE-03).
 */
export class CannotSendError extends DomainError {
    readonly kind = 'forbidden'
    readonly errorKey = 'FORBIDDEN'

    constructor() {
        super('You cannot send messages in this channel')
    }
}

/** Timed out in the server (REQ-ROLE-04): reading only, until `timeoutUntil`. */
export class TimedOutError extends DomainError {
    readonly kind = 'forbidden'
    readonly errorKey = 'MEMBER_TIMED_OUT'
    readonly details: { timeoutUntil: string }

    constructor(timeoutUntil: Date) {
        super(`You are timed out until ${timeoutUntil.toISOString()}`)
        this.details = { timeoutUntil: timeoutUntil.toISOString() }
    }
}
