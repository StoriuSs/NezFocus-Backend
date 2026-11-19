import { MaxPinsReachedError, MessageNotFoundError, MessageRuleError } from './errors'
import { decidePin, MAX_PINS, PinFacts, requirePinsIn } from './pin.rules'

const facts = (over: Partial<PinFacts> = {}): PinFacts => ({
    messageId: 'm1',
    live: true,
    system: false,
    pinned: false,
    pinCount: 0,
    ...over
})

describe('Pinning a message, decided under the lock of its channel pins (REQ-MSG-07)', () => {
    it('pins a message of the channel', () => {
        expect(decidePin(facts())).toBe('pin')
        expect(decidePin(facts({ pinCount: MAX_PINS - 1 }))).toBe('pin')
    })

    it('refuses the 51st pin of a channel', () => {
        expect(() => decidePin(facts({ pinCount: MAX_PINS }))).toThrow(MaxPinsReachedError)
    })

    it('does nothing for a message already pinned, even when the channel is full', () => {
        expect(decidePin(facts({ pinned: true, pinCount: MAX_PINS }))).toBe('already')
    })

    it('refuses a message deleted meanwhile as not found', () => {
        expect(() => decidePin(facts({ live: false }))).toThrow(MessageNotFoundError)
    })

    it('refuses a system message (SRS 1.71)', () => {
        expect(() => decidePin(facts({ system: true }))).toThrow(MessageRuleError)
    })
})

describe('Which channels have pins (D-213)', () => {
    it('a text channel has, a voice room’s chat has not', () => {
        expect(() => requirePinsIn('text')).not.toThrow()
        expect(() => requirePinsIn('voice')).toThrow(expect.objectContaining({ details: { rule: 'room_chat' } }))
    })
})
