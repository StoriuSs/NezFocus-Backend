import { ReactionDecision, ReactionFacts } from '../reaction.rules'
import { MessageAuthor } from './message.repository.port'

/** One emoji on a message, as the person reading it sees it (C-10 ReactionChip). */
export interface ReactionSummary {
    emoji: string
    count: number
    /** The reader gave it. */
    me: boolean
}

/** The first people to give an emoji, and how many gave it (the chip's tooltip). */
export interface Reactors {
    users: MessageAuthor[]
    count: number
}

/** Reactions on messages (REQ-MSG-05): one row per message, emoji and person. */
export interface ReactionRepositoryPort {
    /**
     * Add one person's emoji to a message if `decide` says so, deciding with
     * the message locked: two people adding the 20th and 21st emoji at once
     * cannot both pass, nor a reaction land on a message being deleted.
     * Returns the decision; `decide` throws to refuse.
     */
    add(
        messageId: string,
        emoji: string,
        userId: string,
        decide: (facts: ReactionFacts) => ReactionDecision
    ): Promise<ReactionDecision>
    /** Take one person's emoji off a message; false if they had not given it. */
    remove(messageId: string, emoji: string, userId: string): Promise<boolean>
    /**
     * The emoji of each message, in the order each was first given, as
     * `readerId` sees them; a message without any is absent.
     */
    summaries(messageIds: string[], readerId: string): Promise<Map<string, ReactionSummary[]>>
    /** The first `limit` people to give this emoji, in that order, and the count. */
    reactors(messageId: string, emoji: string, limit: number): Promise<Reactors>
}

export const REACTION_REPOSITORY = Symbol('ReactionRepositoryPort')
