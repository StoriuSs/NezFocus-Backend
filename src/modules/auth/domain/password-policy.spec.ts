import { baseWord, checkPassword } from './password-policy'
import { COMMON_PASSWORD_WORDS } from './common-passwords'

describe('password policy', () => {
    it('refuses a short password, and a common one that passes every composition rule', () => {
        expect(checkPassword('Harbour-Lantern-42')).toEqual([])
        expect(checkPassword('Aa1!aaa')).toContain('min_length')
        expect(checkPassword('Password1!')).toEqual(['common'])
        expect(checkPassword('P@ssw0rd!')).toEqual(['common'])
    })

    it('refuses the email address or the username, dressed up', () => {
        expect(checkPassword('JaneDoe2026!', { email: 'Jane.Doe@example.test' })).toEqual(['matches_email'])
        expect(checkPassword('Harbour_Seven1', { username: 'harbour_seven' })).toEqual(['matches_username'])
    })

    it('holds the common-password list in the form the check compares against', () => {
        // Built by pnpm passwords:generate with baseWord(); a list normalised
        // any other way would silently never match.
        expect(COMMON_PASSWORD_WORDS.size).toBeGreaterThan(8000)
        const unmatched = [...COMMON_PASSWORD_WORDS].filter(
            (word) => baseWord(word) !== word || !/^[a-z]{4,}$/.test(word)
        )
        expect(unmatched).toEqual([])
    })
})
