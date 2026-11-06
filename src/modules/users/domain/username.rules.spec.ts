import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, USERNAME_PATTERN, normaliseUsername } from './username.rules'

// SRS REQ-AUTH-01: lower case, 2-32 characters of a-z 0-9 _ and dot.
describe('username rules', () => {
    it('holds the length bounds at 2 and 32', () => {
        expect(USERNAME_MIN_LENGTH).toBe(2)
        expect(USERNAME_MAX_LENGTH).toBe(32)
    })

    it.each(['ab', 'a'.repeat(32), 'nez.focus_2', 'an.h', '_x', '42'])('accepts %s', (username) => {
        expect(USERNAME_PATTERN.test(username)).toBe(true)
    })

    it.each([
        ['one character', 'a'],
        ['33 characters', 'a'.repeat(33)],
        ['an upper-case letter', 'Anh'],
        ['a space', 'an h'],
        ['a hyphen', 'an-h'],
        ['a Vietnamese letter', 'đức'],
        ['a slash', 'a/b'],
        ['an at sign', 'anh@nez']
    ])('refuses %s', (_case, username) => {
        expect(USERNAME_PATTERN.test(username)).toBe(false)
    })

    it('folds case and trims, so Alice and alice are one name', () => {
        expect(normaliseUsername('  Nez.Focus ')).toBe('nez.focus')
    })
})
