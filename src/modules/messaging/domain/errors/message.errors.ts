import { DomainError } from '@/shared/domain/domain-error'

/** More than 5 messages in 5 seconds in one channel, or 30 in a minute in all (REQ-MSG-10). */
export class SendingTooFastError extends DomainError {
    readonly kind = 'rate_limited'
    readonly errorKey = 'RATE_LIMIT_EXCEEDED'

    constructor(readonly retryAfterSeconds: number) {
        super(`You are sending messages too fast. Try again in ${retryAfterSeconds} seconds.`)
    }
}

/**
 * The author already sent a message with this nonce, in another channel
 * (REQ-MSG-10): only a client fault does that. Nothing of that message is
 * given back, since this channel's permissions say nothing about that one.
 */
export class NonceUsedElsewhereError extends DomainError {
    readonly kind = 'conflict'
    readonly errorKey = 'CONFLICT'

    constructor() {
        super('This nonce was already used for a message in another channel')
    }
}
