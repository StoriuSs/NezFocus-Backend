import { MaxPinsReachedError, MessageNotFoundError, MessageRuleError } from './errors'

/** Pinned messages in one channel (REQ-MSG-07, SRS 3.6). */
export const MAX_PINS = 50

/** What the database says, under the lock of the channel's pins, about pinning a message. */
export interface PinFacts {
    messageId: string
    /** Not deleted (nor gone with its channel) since the request read it. */
    live: boolean
    system: boolean
    pinned: boolean
    /** Pins of the channel now. */
    pinCount: number
}

/** `already`: pinned before; nothing changes, no system message (SRS 1.71). */
export type PinDecision = 'pin' | 'already'

/** Whether the message is pinned (REQ-MSG-07, SRS 1.71): a regular one, while the channel has room. */
export function decidePin(facts: PinFacts): PinDecision {
    if (!facts.live) throw new MessageNotFoundError(facts.messageId)
    if (facts.system) throw new MessageRuleError('system_message')
    if (facts.pinned) return 'already'
    if (facts.pinCount >= MAX_PINS) throw new MaxPinsReachedError()
    return 'pin'
}
