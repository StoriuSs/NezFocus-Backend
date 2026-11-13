import { LimitsUnavailableError } from '@/shared/domain'
import { RateLimitState } from '@/shared/types/rate-limit.type'
import { SendingTooFastError } from '../../domain'
import { SendLimitPort } from '../ports'
import { MESSAGES_PER_CHANNEL, MESSAGES_PER_PERSON } from '../rate-limits'

/** A message counted against the limits, and the way to take it back off them. */
export interface Counted {
    /** For a message that turned out not to be made: another send of its nonce won, or its channel went. */
    release(): Promise<void>
}

/** The counter's answer, or nothing while it cannot be reached. */
async function unlessDown(call: () => Promise<RateLimitState>): Promise<RateLimitState | undefined> {
    try {
        return await call()
    } catch (error) {
        if (error instanceof LimitsUnavailableError) return undefined
        throw error
    }
}

/**
 * Count one message against both limits (application/rate-limits.ts), or
 * refuse it with the wait. A message the minute refuses is taken back from
 * the channel's count: being refused once does not cost a second refusal
 * there.
 *
 * While the counters cannot be reached, messages go on uncounted (SRS 1.69):
 * the auth limits refuse instead (D-137), since they guard codes and
 * passwords; refusing here would stop every conversation while Redis is
 * down. The global throttler still counts every request per address.
 */
export async function countSending(limit: SendLimitPort, userId: string, channelId: string): Promise<Counted> {
    const inChannel = `${userId}:${channelId}`
    const channel = await unlessDown(() => limit.hit(MESSAGES_PER_CHANNEL, inChannel))
    if (channel?.limited) throw new SendingTooFastError(channel.retryAfterSeconds)

    const person = await unlessDown(() => limit.hit(MESSAGES_PER_PERSON, userId))
    if (person?.limited) {
        if (channel) await limit.release(MESSAGES_PER_CHANNEL, inChannel)
        throw new SendingTooFastError(person.retryAfterSeconds)
    }

    return {
        release: async () => {
            if (channel) await limit.release(MESSAGES_PER_CHANNEL, inChannel)
            if (person) await limit.release(MESSAGES_PER_PERSON, userId)
        }
    }
}
