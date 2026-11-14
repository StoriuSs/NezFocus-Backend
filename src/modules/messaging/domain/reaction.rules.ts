import { CannotReactError, MaxReactionsReachedError, MessageNotFoundError, MessageRuleError } from './errors'

/** Different emoji on one message (REQ-MSG-05, SRS 3.6). */
export const MAX_REACTION_EMOJI = 20

/** People named in a reaction's tooltip, the first to give it; the rest are a number (SRS 1.71). */
export const REACTORS_SHOWN = 3

// Built at run time: the `v` flag is newer than the compiler's target, not than Node 22.
const ONE_EMOJI = new RegExp('^\\p{RGI_Emoji}$', 'v')

/**
 * Exactly one standard emoji, as Unicode recommends it for general use
 * (RGI): a skin tone, a family or a flag counts as one. No custom emoji
 * (SRS 1.71); text, two emoji or an emoji with a space around it is refused.
 * The set is Node's (its Unicode version): the picker's data is a release
 * that version knows.
 */
export const isEmoji = (text: string): boolean => ONE_EMOJI.test(text)

const VARIATION_SELECTOR = /\u{FE0F}/gu

/**
 * The one form an emoji is kept and compared in, or null if it is not one
 * standard emoji. Emoji data (the picker's included) writes some with a
 * variation selector the standard form lacks ("👍" + U+FE0F); without this,
 * one emoji could become two reactions on a message. A selector the standard
 * form needs ("❤️") stays.
 */
export function normaliseEmoji(text: string): string | null {
    if (isEmoji(text)) return text
    const bare = text.replace(VARIATION_SELECTOR, '')
    return bare !== text && isEmoji(bare) ? bare : null
}

/** What the database says, under the lock of the message, about adding one person's emoji to it. */
export interface ReactionFacts {
    messageId: string
    /** Not deleted (nor gone with its channel) since the request read it. */
    live: boolean
    system: boolean
    /** Someone already gave this emoji to this message. */
    onMessage: boolean
    /** This person did. */
    mine: boolean
    /** Different emoji on the message now. */
    emojiCount: number
}

/** `already`: they gave this emoji before; nothing changes, no one is told. */
export type ReactionDecision = 'add' | 'already'

/**
 * Whether the reaction is added (REQ-MSG-05, SRS 1.71). An emoji already on
 * the message may be clicked by anyone who sees the channel; a new one needs
 * ADD_REACTIONS and room under 20.
 */
export function decideReaction(facts: ReactionFacts, { mayAddNew }: { mayAddNew: boolean }): ReactionDecision {
    if (!facts.live) throw new MessageNotFoundError(facts.messageId)
    if (facts.system) throw new MessageRuleError('system_message')
    if (facts.mine) return 'already'
    if (facts.onMessage) return 'add'
    if (!mayAddNew) throw new CannotReactError()
    if (facts.emojiCount >= MAX_REACTION_EMOJI) throw new MaxReactionsReachedError()
    return 'add'
}
