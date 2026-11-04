/**
 * Username rules.
 *
 * A username is permanent (set once), publicly displayed and used to address
 * an account, so the character set is deliberately narrow: anything that can
 * be confused with another user's handle is an impersonation vector. That
 * rules out whitespace, path separators, bidirectional overrides and
 * homoglyph-rich scripts.
 */
export const USERNAME_PATTERN = /^[a-z0-9_]{3,25}$/

export const USERNAME_MAX_LENGTH = 25

/**
 * Canonical form used for both storage and lookup.
 *
 * Uniqueness must be case-insensitive — with a byte-exact index `Alice`,
 * `alice` and `ALICE` are three distinct accounts and the availability check
 * reports all three as free.
 */
export function normaliseUsername(username: string): string {
    return username.trim().toLowerCase()
}
