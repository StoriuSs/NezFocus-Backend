import type { RateLimitRule, RateLimitState } from '../rate-limits'

/** Fixed-window counters shared by every instance. Implemented by the shared RateLimiter. */
export interface RateLimitPort {
    hit(rule: RateLimitRule, subject: string): Promise<RateLimitState>
    check(rule: RateLimitRule, subject: string): Promise<RateLimitState>
    /** Take back one hit (never below zero): a guess counted up front that turned out right. */
    release(rule: RateLimitRule, subject: string): Promise<void>
    reset(rule: RateLimitRule, subject: string): Promise<void>
}

export const RATE_LIMIT = Symbol('RateLimitPort')
