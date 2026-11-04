/** A named limit: at most `limit` hits per `windowMs`, per subject. */
export interface RateLimitRule {
    /** Part of the Redis key; one name per limit. */
    name: string
    limit: number
    windowMs: number
}

export interface RateLimitState {
    /** Hits in the current window, this one included when it came from `hit`. */
    count: number
    /** Whether the subject is over the limit. */
    limited: boolean
    /** Seconds until the window resets; 0 when there is no window. */
    retryAfterSeconds: number
}
