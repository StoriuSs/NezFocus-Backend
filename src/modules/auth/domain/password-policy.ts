import { COMMON_PASSWORD_WORDS } from './common-passwords'

/**
 * The password rules, in one place.
 *
 * The same policy the Keycloak starter documents — at least 8 characters, an
 * upper-case letter, a lower-case letter, a digit and a special character, and
 * not the email or username (being one, not containing one) — so the two
 * starters behave alike. Plus one rule
 * composition rules need: `Password1!` and `P@ssw0rd` satisfy every other one,
 * and they are exactly the passwords composition rules produce. So the word a
 * password is built around is checked against the ~8,500 most common.
 *
 * Pure, and free of framework imports, so the frontend can mirror it exactly.
 * Each rule has a stable id; the message beside it is what a person reads.
 */
export const PASSWORD_MIN_LENGTH = 8
/** A bound on argon2's work per attempt, not a security rule. */
export const PASSWORD_MAX_LENGTH = 128

export type PasswordRule =
    | 'min_length'
    | 'max_length'
    | 'lowercase'
    | 'uppercase'
    | 'digit'
    | 'special'
    | 'matches_email'
    | 'matches_username'
    | 'common'

export const PASSWORD_RULE_MESSAGES: Record<PasswordRule, string> = {
    min_length: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
    max_length: `Use at most ${PASSWORD_MAX_LENGTH} characters.`,
    lowercase: 'Include a lower-case letter.',
    uppercase: 'Include an upper-case letter.',
    digit: 'Include a digit.',
    special: 'Include a character that is not a letter or a digit.',
    matches_email: 'Do not use your email address as your password.',
    matches_username: 'Do not use your username as your password.',
    common: 'This password is too common. Choose one that is harder to guess.'
}

const LEET: Record<string, string> = {
    '@': 'a',
    '4': 'a',
    '3': 'e',
    '1': 'i',
    '!': 'i',
    '0': 'o',
    $: 's',
    '5': 's',
    '7': 't'
}

/**
 * The word a password is built around: lower case, digits and symbols trimmed
 * from both ends, and common substitutions undone. `Password1!` and `P@ssw0rd`
 * both come out as `password`. The common-password list was normalised the
 * same way (scripts: see common-passwords.ts).
 */
export function baseWord(password: string): string {
    const trimmed = password.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, '')
    return [...trimmed].map((char) => LEET[char] ?? char).join('')
}

export interface PasswordContext {
    email?: string | null
    username?: string | null
}

/**
 * The letters of the word something is built around: `Uiia2024!`, `U-i-i-a`
 * and `Ui1a` all give `uiia`. Used to compare a password with the identity.
 */
function identityLetters(value: string): string {
    return baseWord(value).replace(/[^a-z]/g, '')
}

/** Identities whose letters are fewer than this match too much to be compared that way. */
const MIN_IDENTITY_LETTERS = 3

/**
 * Whether the password is the identity: the same text, or the same letters
 * once digits, symbols and common swaps are set aside. Only *being* it counts,
 * as with Keycloak's notUsername and notEmail: `Uiia2024!` is refused for the
 * username `uiia`, `UiiaUiia1~` and `Harbour-Uiia-42` are not.
 */
function isIdentity(password: string, identity: string): boolean {
    if (password.toLowerCase() === identity) return true
    const letters = identityLetters(identity)
    return letters.length >= MIN_IDENTITY_LETTERS && identityLetters(password) === letters
}

/**
 * Every rule the password breaks, in a stable order. Empty means it is
 * acceptable.
 */
export function checkPassword(password: string, context: PasswordContext = {}): PasswordRule[] {
    const broken: PasswordRule[] = []
    const characters = [...password]

    if (characters.length < PASSWORD_MIN_LENGTH) broken.push('min_length')
    if (characters.length > PASSWORD_MAX_LENGTH) broken.push('max_length')
    if (!/\p{Ll}/u.test(password)) broken.push('lowercase')
    if (!/\p{Lu}/u.test(password)) broken.push('uppercase')
    if (!/\p{Nd}/u.test(password)) broken.push('digit')
    if (!/[^\p{L}\p{Nd}]/u.test(password)) broken.push('special')

    const email = context.email?.trim().toLowerCase()
    if (email && (isIdentity(password, email) || isIdentity(password, email.split('@')[0]))) {
        broken.push('matches_email')
    }
    const username = context.username?.trim().toLowerCase()
    if (username && isIdentity(password, username)) broken.push('matches_username')

    const word = baseWord(password)
    if (/^[a-z]{4,}$/.test(word) && COMMON_PASSWORD_WORDS.has(word)) broken.push('common')

    return broken
}
