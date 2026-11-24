import { RateLimitRule, RateLimitState } from '@/shared/types/rate-limit.type'

/** Counts friend requests and username lookups per person (REQ-SOCIAL-01, D-110); RateLimiter in production. */
export interface SocialLimitPort {
    /** Count one. */
    hit(rule: RateLimitRule, subject: string): Promise<RateLimitState>
    /** Take back one count: a request that turned out not to be a new one. */
    release(rule: RateLimitRule, subject: string): Promise<void>
}

export const SOCIAL_LIMIT = Symbol('SocialLimitPort')
