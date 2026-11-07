import {
    BIO_MAX_LENGTH,
    DISPLAY_NAME_MAX_LENGTH,
    characterCount,
    displayNameFrom,
    isBio,
    isDisplayName,
    normaliseProfileText
} from './profile-text.rules'

// SRS REQ-AUTH-06, D-69, D-139: counted in code points after NFC; a display
// name needs something you can see.
describe('profile text rules', () => {
    const decomposed = 'Nguyễn' // "Nguyễn" typed as e + two combining marks

    it('holds the limits at 32 and 200', () => {
        expect(DISPLAY_NAME_MAX_LENGTH).toBe(32)
        expect(BIO_MAX_LENGTH).toBe(200)
    })

    it('composes and trims, so a decomposed Vietnamese letter counts once', () => {
        expect(normaliseProfileText(`  ${decomposed} `)).toBe('Nguyễn')
        expect(characterCount(normaliseProfileText(decomposed))).toBe(6)
    })

    it('counts an emoji once, not as its two UTF-16 halves', () => {
        expect(characterCount('🙂')).toBe(1)
        expect('🙂'.length).toBe(2)
    })

    describe('display name', () => {
        it.each([
            ['a one-letter name', 'A'],
            ['32 letters', 'a'.repeat(32)],
            ['32 emoji (64 UTF-16 units)', '🙂'.repeat(32)],
            ['32 Vietnamese letters typed decomposed', normaliseProfileText('ễ'.repeat(32))],
            ['a space inside', 'Thanh An'],
            ['a zero-width joiner inside an emoji', '👩‍💻 An'],
            ['a hidden character next to a real one', 'An​']
        ])('accepts %s', (_case, name) => {
            expect(isDisplayName(name)).toBe(true)
        })

        it.each([
            ['nothing', ''],
            ['33 letters', 'a'.repeat(33)],
            ['33 emoji', '🙂'.repeat(33)],
            ['only a zero-width space', '​'],
            ['only Hangul fillers', 'ㅤㅤ'],
            ['only half-width Hangul fillers and choseong fillers', 'ﾠᅟ'],
            ['only a right-to-left override', '‮'],
            ['a line break', 'Thanh\nAn'],
            ['a tab', 'Thanh\tAn'],
            ['a null character', 'An\u0000']
        ])('refuses %s', (_case, name) => {
            expect(isDisplayName(name)).toBe(false)
        })
    })

    describe('bio', () => {
        it.each([
            ['nothing (clears it)', ''],
            ['200 characters', 'a'.repeat(200)],
            ['200 emoji', '🙂'.repeat(200)],
            ['line breaks', 'Ôn Giải tích 2\nmỗi tối 21:00']
        ])('accepts %s', (_case, bio) => {
            expect(isBio(bio)).toBe(true)
        })

        it.each([
            ['201 characters', 'a'.repeat(201)],
            ['a tab', 'a\tb'],
            ['an escape character', 'a\u001Bb']
        ])('refuses %s', (_case, bio) => {
            expect(isBio(bio)).toBe(false)
        })
    })

    describe('a name from Google', () => {
        it('cuts a long name at 32 characters without splitting an emoji', () => {
            // Cut by UTF-16 units, the 32nd unit is the first half of the emoji.
            expect(displayNameFrom(`${'a'.repeat(31)}🙂🙂`)).toBe(`${'a'.repeat(31)}🙂`)
        })

        it('composes, trims, and trims again after the cut', () => {
            expect(displayNameFrom(`  ${decomposed}  `)).toBe('Nguyễn')
            expect(displayNameFrom(`${'a'.repeat(31)} b`)).toBe('a'.repeat(31))
        })

        it.each([
            ['missing', null],
            ['empty', '  '],
            ['only hidden characters', 'ㅤ​'],
            ['broken across lines', 'Thanh\nAn']
        ])('gives no name when it is %s', (_case, name) => {
            expect(displayNameFrom(name)).toBeNull()
        })
    })
})
