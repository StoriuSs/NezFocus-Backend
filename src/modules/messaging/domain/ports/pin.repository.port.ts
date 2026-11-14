import { PinDecision, PinFacts } from '../pin.rules'
import { MessageRecord } from './message.repository.port'

/** A pinned message, and when it was pinned (S-CHAT-02). */
export interface PinnedMessage {
    message: MessageRecord
    pinnedAt: Date
}

/** The pins of channels (REQ-MSG-07): at most 50 rows a channel. */
export interface PinRepositoryPort {
    /**
     * Pin a message of the channel if `decide` says so, deciding under a lock
     * of the channel's pins (two pins at once cannot make a 51st) with the
     * message held against deletion. A pin also saves the system message
     * "<who> pinned a message" (REQ-MSG-08) in the same transaction, returned
     * as `notice`. `decide` throws to refuse.
     */
    pin(
        channelId: string,
        messageId: string,
        userId: string,
        decide: (facts: PinFacts) => PinDecision
    ): Promise<{ decision: PinDecision; notice: MessageRecord | null }>
    /** Unpin a message of the channel; false if it was not pinned. */
    unpin(channelId: string, messageId: string): Promise<boolean>
    /** The channel's pinned messages, the latest pinned first. */
    list(channelId: string): Promise<PinnedMessage[]>
}

export const PIN_REPOSITORY = Symbol('PinRepositoryPort')
