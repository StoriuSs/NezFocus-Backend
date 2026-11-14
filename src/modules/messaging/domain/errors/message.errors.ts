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

/**
 * No such message, it was deleted, or its channel is one the person may not
 * view: the same answer for all, naming no channel (NFR-SEC-05).
 */
export class MessageNotFoundError extends DomainError {
    readonly kind = 'not_found'
    readonly errorKey = 'NOT_FOUND'

    constructor(messageId: string) {
        super(`Message not found: ${messageId}`)
    }
}

/** Only its author edits a message; a system message no one (REQ-MSG-05, REQ-MSG-08). */
export class NotYourMessageError extends DomainError {
    readonly kind = 'forbidden'
    readonly errorKey = 'FORBIDDEN'

    constructor() {
        super('Only its author can edit a message')
    }
}

/** Someone else's message without MANAGE_MESSAGES, or a system message (REQ-MSG-05). */
export class CannotDeleteMessageError extends DomainError {
    readonly kind = 'forbidden'
    readonly errorKey = 'FORBIDDEN'

    constructor() {
        super('You cannot delete this message')
    }
}

/**
 * Which rule of messages a request breaks; `data.rule` on the error:
 * - `reply_target`: a reply answers a regular message of the same channel
 *   (REQ-MSG-05). The client only answers messages it shows, so only a
 *   forged request gets here.
 * - `system_message`: a system message takes no reaction and no pin
 *   (SRS 1.71); it has no toolbar, so again only a forged request.
 * - `emoji`: a reaction is exactly one standard emoji (SRS 1.71).
 */
export type MessageRule = 'reply_target' | 'system_message' | 'emoji'

/** A message that breaks one of the rules above. */
export class MessageRuleError extends DomainError {
    readonly kind = 'unprocessable'
    readonly errorKey = 'VALIDATION_ERROR'
    readonly details: { rule: MessageRule }

    constructor(rule: MessageRule) {
        super(`Message rule broken: ${rule}`)
        this.details = { rule }
    }
}

/** A new emoji on a message without ADD_REACTIONS; one already there may still be clicked (SRS 1.71). */
export class CannotReactError extends DomainError {
    readonly kind = 'forbidden'
    readonly errorKey = 'FORBIDDEN'

    constructor() {
        super('You cannot add a new reaction in this channel')
    }
}

/** A 21st different emoji on one message (REQ-MSG-05). */
export class MaxReactionsReachedError extends DomainError {
    readonly kind = 'conflict'
    readonly errorKey = 'MAX_REACTIONS_REACHED'

    constructor() {
        super('This message has as many different reactions as it can have')
    }
}

/** Pinning, or unpinning, without MANAGE_MESSAGES (REQ-MSG-07). */
export class CannotPinError extends DomainError {
    readonly kind = 'forbidden'
    readonly errorKey = 'FORBIDDEN'

    constructor() {
        super('You cannot pin messages in this channel')
    }
}

/** A 51st pin in one channel (REQ-MSG-07). */
export class MaxPinsReachedError extends DomainError {
    readonly kind = 'conflict'
    readonly errorKey = 'MAX_PINS_REACHED'

    constructor() {
        super('This channel has as many pinned messages as it can have')
    }
}
