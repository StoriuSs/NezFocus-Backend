/**
 * Every limit the auth module enforces, in one place (docs/auth/rate-limits.md).
 * They sit on top of the global throttler, which counts requests per user
 * when signed in and per IP when not; these count one operation, per address
 * or per IP.
 *
 * Limits per IP use short windows (D-135): students share a lab's or a hall's
 * one public IP, and someone else's mistakes there should cost minutes, not
 * an hour. Guessing at one account is held back by the limits per address,
 * whatever the IP.
 *
 * Limits keyed on an address are counted whether or not it has an account,
 * so hitting one says nothing about whether it exists.
 */
import type { RateLimitReason } from '@/modules/auth/domain'
import type { RateLimitRule as SharedRateLimitRule, RateLimitState } from '@/shared/types/rate-limit.type'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
/** The window of every limit per IP (D-135). */
const IP_WINDOW = 5 * MINUTE

/**
 * What a refusal says, so the person knows what to do (RateLimitReason, in
 * auth.errors.ts): `network` limits count per IP, so everyone behind one
 * office or school connection shares them.
 */
export type { RateLimitReason }

/** A shared limit, and the reason a refusal by it gives. */
export interface RateLimitRule extends SharedRateLimitRule {
    reason: RateLimitReason
}

export type { RateLimitState }

export const AUTH_RATE_LIMITS = {
    /**
     * Failed sign-ins per address. The trade-off is deliberate: this lets
     * someone lock a person out for a quarter of an hour by failing five times
     * on purpose, and without it a botnet could guess one account's password
     * from thousands of addresses.
     */
    loginFailuresPerEmail: { name: 'login-fail-email', limit: 5, windowMs: 15 * MINUTE, reason: 'sign_ins' },
    /** Failed sign-ins per IP, across any addresses: one host spraying passwords. */
    loginFailuresPerIp: { name: 'login-fail-ip', limit: 30, windowMs: IP_WINDOW, reason: 'network' },
    /**
     * Emails with a code, per address: one a minute, five an hour, shared by
     * sign-in and reset codes (REQ-AUTH-02). Stops mail-bombing. There is no
     * separate limit on new accounts: each one needs a code from these.
     * The minute's refusal has its own reason (D-136): one code went out a
     * moment ago, from another tab or flow, and "several emails" would be wrong.
     */
    codeEmailsPerEmailMinute: { name: 'code-email-min', limit: 1, windowMs: MINUTE, reason: 'recent_email' },
    codeEmailsPerEmailHour: { name: 'code-email-hour', limit: 5, windowMs: HOUR, reason: 'emails' },
    /** Emails with a code requested from one IP, for any addresses. */
    codeEmailsPerIp: { name: 'code-email-ip', limit: 30, windowMs: IP_WINDOW, reason: 'network' },
    /**
     * Wrong codes per IP, across addresses. Each code also dies after five
     * wrong guesses; this stops spreading guesses over many addresses. Only
     * wrong codes count: a right one is used up anyway.
     */
    codeAttemptsPerIp: { name: 'code-try-ip', limit: 30, windowMs: IP_WINDOW, reason: 'network' },
    /**
     * Wrong codes per address, across its codes (D-134). Each new code has
     * five tries, and five codes an hour would give a stranger 25 guesses an
     * hour at an account from many IPs; this keeps it to ten. Counted for
     * every address, with an account or not.
     */
    codeFailuresPerEmail: { name: 'code-fail-email', limit: 10, windowMs: HOUR, reason: 'codes' },
    /** Wrong current passwords when changing it, per user. */
    currentPasswordFailuresPerUser: {
        name: 'change-pw-fail',
        limit: 5,
        windowMs: 15 * MINUTE,
        reason: 'wrong_password'
    }
} satisfies Record<string, RateLimitRule>
