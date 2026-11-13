import { RateLimitRule, RateLimitState } from '@/shared/types/rate-limit.type'

/** Counts messages sent per person (REQ-MSG-10); RateLimiter in production. */
export interface SendLimitPort {
    /** Count one message. */
    hit(rule: RateLimitRule, subject: string): Promise<RateLimitState>
    /** Take back one count: a message refused by the other rule. */
    release(rule: RateLimitRule, subject: string): Promise<void>
}

export const SEND_LIMIT = Symbol('SendLimitPort')
