import { RateLimitRule } from '@/shared/types/rate-limit.type'
import { FRIEND_REQUESTS_PER_DAY } from '../domain'

/*
 * The limits the social module counts itself (REQ-SOCIAL-01, D-242), in one
 * table (docs/adding-a-module.md › Names and places, Limits).
 */

/**
 * At most 50 friend requests a day of the sender's own time zone. The
 * subject is `<userId>:<YYYY-MM-DD>` of that day, so a new day starts a new
 * count at their midnight; the window only has to outlive the longest day
 * (25 hours, when clocks go back). Counted by services/change-relationship.ts.
 */
export const FRIEND_REQUESTS_PER_PERSON_DAY: RateLimitRule = {
    name: 'friend-requests',
    limit: FRIEND_REQUESTS_PER_DAY,
    windowMs: 25 * 60 * 60 * 1000
}

/** At most 30 username lookups a minute from one person (D-110): enough to fix typos, not to walk the names. */
export const USER_LOOKUPS_PER_PERSON: RateLimitRule = { name: 'user-lookups', limit: 30, windowMs: 60 * 1000 }
