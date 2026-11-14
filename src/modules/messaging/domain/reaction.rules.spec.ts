import { CannotReactError, MaxReactionsReachedError, MessageNotFoundError, MessageRuleError } from './errors'
import { decideReaction, isEmoji, MAX_REACTION_EMOJI, normaliseEmoji, ReactionFacts } from './reaction.rules'

const facts = (over: Partial<ReactionFacts> = {}): ReactionFacts => ({
    messageId: 'm1',
    live: true,
    system: false,
    onMessage: false,
    mine: false,
    emojiCount: 0,
    ...over
})

describe('A reaction is one standard emoji (REQ-MSG-05, SRS 1.71)', () => {
    it.each(['👍', '🎉', '❤️', '👍🏽', '👨‍👩‍👧', '🇻🇳', '1️⃣'])('takes %s', (emoji) => {
        expect(isEmoji(emoji)).toBe(true)
    })

    it.each(['', 'a', ':+1:', '👍👍', '👍 ', '<script>', '❤', '​'])('refuses %j', (text) => {
        expect(isEmoji(text)).toBe(false)
        expect(normaliseEmoji(text)).toBeNull()
    })

    it('keeps one form per emoji: a variation selector the standard form lacks is dropped, one it needs kept', () => {
        // Emoji pickers write some with U+FE0F ("👍️"); the standard form has none.
        expect(normaliseEmoji('👍\u{FE0F}')).toBe('👍')
        expect(normaliseEmoji('👍')).toBe('👍')
        expect(normaliseEmoji('❤️')).toBe('❤️')
    })
})

describe('Adding a reaction, decided under the lock of its message (REQ-MSG-05)', () => {
    it('adds a new emoji for someone allowed to add new ones', () => {
        expect(decideReaction(facts(), { mayAddNew: true })).toBe('add')
    })

    it('lets anyone who sees the channel click an emoji already on the message', () => {
        expect(decideReaction(facts({ onMessage: true }), { mayAddNew: false })).toBe('add')
    })

    it('refuses a new emoji without ADD_REACTIONS', () => {
        expect(() => decideReaction(facts(), { mayAddNew: false })).toThrow(CannotReactError)
    })

    it('does nothing for an emoji one already gave', () => {
        expect(decideReaction(facts({ onMessage: true, mine: true }), { mayAddNew: true })).toBe('already')
    })

    it('refuses a 21st different emoji, but not one more person on an emoji already there', () => {
        const full = facts({ emojiCount: MAX_REACTION_EMOJI })
        expect(() => decideReaction(full, { mayAddNew: true })).toThrow(MaxReactionsReachedError)
        expect(decideReaction({ ...full, onMessage: true }, { mayAddNew: true })).toBe('add')
        expect(decideReaction(facts({ emojiCount: MAX_REACTION_EMOJI - 1 }), { mayAddNew: true })).toBe('add')
    })

    it('refuses a message deleted meanwhile as not found', () => {
        expect(() => decideReaction(facts({ live: false }), { mayAddNew: true })).toThrow(MessageNotFoundError)
    })

    it('refuses a system message (no toolbar, SRS 1.71)', () => {
        expect(() => decideReaction(facts({ system: true }), { mayAddNew: true })).toThrow(MessageRuleError)
    })
})
