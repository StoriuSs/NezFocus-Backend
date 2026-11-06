/**
 * The password rules, in one place (SRS REQ-AUTH-01, D-29, D-66).
 *
 * 8-128 characters with an upper-case letter, a lower-case letter, a digit
 * and a special character (any character that is not a letter or a digit;
 * Vietnamese letters count as letters), and not the email, the part of the
 * email before @, or the username. Only *being* one counts, not containing
 * one.
 *
 * There is no list of common passwords (D-29): the app uses the same rules,
 * and the person sees every rule while typing. The trade-off is written in
 * D-29: `Password1!` passes.
 *
 * Pure, and free of framework imports, so the frontend can mirror it exactly
 * (NezFocus-Frontend src/features/auth/lib/password-rules.ts). Each rule has a
 * stable id; the message beside it is what a person reads.
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

export const PASSWORD_RULE_MESSAGES: Record<PasswordRule, string> = {
    min_length: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
    max_length: `Use at most ${PASSWORD_MAX_LENGTH} characters.`,
    lowercase: 'Include a lower-case letter.',
    uppercase: 'Include an upper-case letter.',
    digit: 'Include a digit.',
    special: 'Include a character that is not a letter or a digit.',
    matches_email: 'Do not use your email address as your password.',
    matches_username: 'Do not use your username as your password.'
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
 * The word something is built around: lower case, digits and symbols trimmed
 * from both ends, and common substitutions undone. `Password1!` and `P@ssw0rd`
 * both come out as `password`.
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
 * once digits, symbols and common swaps are set aside. Only *being* it counts
 * (D-66): `Uiia2024!` is refused for the username `uiia`, `UiiaUiia1~` and
 * `Harbour-Uiia-42` are not.
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

    return broken
}
