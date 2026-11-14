import { hasSomething, isMessageContent, MAX_MESSAGE_LENGTH, normaliseMessageContent } from './message.rules'

describe('The text of a message (REQ-MSG-01)', () => {
    it('is kept composed (NFC), without the blank around it, the blank inside kept', () => {
        expect(normaliseMessageContent('  \n Tiếng Việt\n\n    code\n ')).toBe('Tiếng Việt\n\n    code')
    })

    it('counts characters as people do: an emoji or a letter with its accents is one', () => {
        expect(isMessageContent('😀'.repeat(MAX_MESSAGE_LENGTH))).toBe(true)
        expect(isMessageContent('😀'.repeat(MAX_MESSAGE_LENGTH + 1))).toBe(false)
        const accented = normaliseMessageContent('é'.repeat(MAX_MESSAGE_LENGTH))
        expect(isMessageContent(accented)).toBe(true)
    })

    it('counts what is kept: blank lines after 2000 characters do not count', () => {
        expect(isMessageContent(normaliseMessageContent(`${'a'.repeat(MAX_MESSAGE_LENGTH)}\n\n`))).toBe(true)
    })

    it('needs some text, or a file (D-93)', () => {
        const blank = normaliseMessageContent(' \n\t ')
        expect(isMessageContent(blank)).toBe(true)
        expect(hasSomething(blank, 0)).toBe(false)
        expect(hasSomething(blank, 1)).toBe(true)
        expect(hasSomething('a', 0)).toBe(true)
    })
})
