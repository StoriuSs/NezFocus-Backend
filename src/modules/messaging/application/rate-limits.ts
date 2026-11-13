import { RateLimitRule } from '@/shared/types/rate-limit.type'

/*
 * The limits the messaging module counts itself (REQ-MSG-10), in one table
 * (docs/adding-a-module.md › Names and places, Limits). Each person is
 * counted alone: a busy channel never stops someone who has sent little.
 * Counted by services/sending-limits.ts.
 */

/** At most 5 messages in 5 seconds from one person in one channel. */
export const MESSAGES_PER_CHANNEL: RateLimitRule = { name: 'messages-channel', limit: 5, windowMs: 5 * 1000 }
/** At most 30 messages a minute from one person, all channels together. */
export const MESSAGES_PER_PERSON: RateLimitRule = { name: 'messages-person', limit: 30, windowMs: 60 * 1000 }
