import { RateLimitRule, RateLimitState } from '@/shared/types/rate-limit.type'

/** Counts wrong invite codes per network (REQ-SRV-03); RateLimiter in production. */
export interface GuessLimitPort {
    /** Whether the network has already spent its allowance, without counting. */
    check(rule: RateLimitRule, subject: string): Promise<RateLimitState>
    /** Count one wrong code. */
    hit(rule: RateLimitRule, subject: string): Promise<RateLimitState>
}

export const GUESS_LIMIT = Symbol('GuessLimitPort')
