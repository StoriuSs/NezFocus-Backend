/**
 * Every limit the auth module enforces, in one place (docs/auth/rate-limits.md).
 * They sit on top of the global throttler, which counts every
 * request per IP; these count one operation, per address or per IP.
 *
 * Limits keyed on an address are counted whether or not it has an account,
 * so hitting one says nothing about whether it exists.
 */
import type { RateLimitReason } from '@/modules/auth/domain'
import type { RateLimitRule as SharedRateLimitRule, RateLimitState } from '@/shared/types/rate-limit.type'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

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
    loginFailuresPerIp: { name: 'login-fail-ip', limit: 10, windowMs: 15 * MINUTE, reason: 'network' },
    /** New accounts per IP. */
    registrationsPerIp: { name: 'register-ip', limit: 5, windowMs: HOUR, reason: 'network' },
    /**
     * Sign-up emails per address, a minute: its own counter, so that "sign up,
     * read the email, ask for a code" is not refused for the minute sign-up
     * used. The five an hour are shared with every code email.
     */
    registrationsPerEmailMinute: { name: 'register-email-min', limit: 1, windowMs: MINUTE, reason: 'emails' },
    /** Emails with a code, per address: one a minute, five an hour. Stops mail-bombing. */
    codeEmailsPerEmailMinute: { name: 'code-email-min', limit: 1, windowMs: MINUTE, reason: 'emails' },
    codeEmailsPerEmailHour: { name: 'code-email-hour', limit: 5, windowMs: HOUR, reason: 'emails' },
    /** Emails with a code requested from one IP, for any addresses. */
    codeEmailsPerIp: { name: 'code-email-ip', limit: 10, windowMs: HOUR, reason: 'network' },
    /**
     * Wrong codes per IP, across addresses. Each code also dies after five
     * wrong guesses; this stops spreading guesses over many addresses. Only
     * wrong codes count: a right one is used up anyway.
     */
    codeAttemptsPerIp: { name: 'code-try-ip', limit: 20, windowMs: HOUR, reason: 'network' },
    /** Wrong current passwords when changing it, per user. */
    currentPasswordFailuresPerUser: {
        name: 'change-pw-fail',
        limit: 5,
        windowMs: 15 * MINUTE,
        reason: 'wrong_password'
    }
} satisfies Record<string, RateLimitRule>
