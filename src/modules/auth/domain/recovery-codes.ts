import { randomInt } from 'crypto'

/**
 * Recovery codes: for signing in when the authenticator app is gone. Ten,
 * each usable once, shown once. `K7Q2M-X9HDP`: ten characters from an
 * alphabet without the ones people misread (0/O, 1/I/L), so 50 bits each.
 */
export const RECOVERY_CODE_COUNT = 10

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const LENGTH = 10

export function newRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
    return Array.from({ length: count }, () => {
        const chars = Array.from({ length: LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
        return `${chars.slice(0, 5)}-${chars.slice(5)}`
    })
}

/**
 * The form a code is compared in: case, spaces and the dash ignored, so
 * `k7q2m x9hdp` is the same code. Null for anything that cannot be one.
 */
export function normaliseRecoveryCode(input: string): string | null {
    const chars = input.toUpperCase().replace(/[\s-]/g, '')
    if (chars.length !== LENGTH || [...chars].some((char) => !ALPHABET.includes(char))) return null
    return chars
}
