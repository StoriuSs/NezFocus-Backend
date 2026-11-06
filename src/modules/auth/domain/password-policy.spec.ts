import { checkPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './password-policy'

// The rules of SRS REQ-AUTH-01, D-29 and D-66. Each case breaks exactly one
// rule, so loosening any rule turns its case red.
describe('password policy', () => {
    it('accepts a password that meets every rule', () => {
        expect(checkPassword('Harbour-Lantern-42')).toEqual([])
    })

    it.each([
        ['min_length', 'Aa1!aaa'],
        ['max_length', `Aa1!${'a'.repeat(PASSWORD_MAX_LENGTH - 3)}`],
        ['lowercase', 'HARBOUR-42'],
        ['uppercase', 'harbour-42'],
        ['digit', 'Harbour-Lantern'],
        ['special', 'HarbourLantern42']
    ])('refuses a password that breaks only %s', (rule, password) => {
        expect(checkPassword(password)).toEqual([rule])
    })

    it('holds the length bounds at 8 and 128 characters', () => {
        expect(PASSWORD_MIN_LENGTH).toBe(8)
        expect(PASSWORD_MAX_LENGTH).toBe(128)
        expect(checkPassword('Aa1!aaaa')).toEqual([])
        expect(checkPassword(`Aa1!${'a'.repeat(PASSWORD_MAX_LENGTH - 4)}`)).toEqual([])
    })

    it('names every missing rule, as the SRS example ontap2026 does', () => {
        expect(checkPassword('ontap2026')).toEqual(['uppercase', 'special'])
    })

    it('counts Vietnamese letters as letters and a space as a special character', () => {
        expect(checkPassword('Đàlạt 2026')).toEqual([])
        expect(checkPassword('ĐÀLẠT 2026')).toEqual(['lowercase'])
    })

    it('does not refuse a common password (D-29)', () => {
        expect(checkPassword('Password1!')).toEqual([])
        expect(checkPassword('P@ssw0rd!')).toEqual([])
    })

    it('refuses the email address, its local part or the username, dressed up (D-66)', () => {
        expect(checkPassword('jane.doe@example.test', { email: 'Jane.Doe@example.test' })).toContain('matches_email')
        expect(checkPassword('JaneDoe2026!', { email: 'Jane.Doe@example.test' })).toEqual(['matches_email'])
        expect(checkPassword('Harbour_Seven1', { username: 'harbour_seven' })).toEqual(['matches_username'])
        expect(checkPassword('Harbour.Seven1', { username: 'harbour.seven' })).toEqual(['matches_username'])
    })

    it('allows a password that only contains the email or the username (D-66)', () => {
        expect(checkPassword('JaneDoe-Harbour-42', { email: 'jane.doe@example.test' })).toEqual([])
        expect(checkPassword('Harbour-Seven-Lantern-1', { username: 'harbour_seven' })).toEqual([])
    })
})
