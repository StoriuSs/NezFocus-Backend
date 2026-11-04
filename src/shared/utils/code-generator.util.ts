import { randomInt } from 'crypto'

/**
 * Generate a random numeric verification code.
 *
 * Uses `crypto.randomInt`, not `Math.random()`: verification codes are a
 * security control, and Math.random is a predictable PRNG seeded per process.
 *
 * Zero-padded so the full keyspace is available. The previous implementation
 * started the range at 10^(length-1), which silently discarded every code with
 * a leading zero — 900,000 possibilities instead of 1,000,000 for a 6-digit
 * code.
 *
 * @param length - Number of digits (default: 6)
 * @returns String of random digits
 * @example
 * generateVerificationCode() // '012345'
 * generateVerificationCode(4) // '9876'
 */
export function generateVerificationCode(length: number = 6): string {
    const max = Math.pow(10, length)
    return randomInt(0, max).toString().padStart(length, '0')
}
