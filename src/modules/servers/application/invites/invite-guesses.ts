import { LimitsUnavailableError } from '@/shared/domain'
import { RateLimitRule } from '@/shared/types/rate-limit.type'
import { InviteGuessesLimitedError, InviteInvalidError } from '../../domain'
import { GuessLimitPort } from '../ports'

/** More than 30 wrong codes a minute from one network is refused (REQ-SRV-03). */
export const INVITE_GUESSES_PER_NETWORK: RateLimitRule = { name: 'invite-guess-ip', limit: 30, windowMs: 60 * 1000 }

/** The counter's answer, or nothing while it cannot be reached. */
async function unlessDown<T>(call: () => Promise<T>): Promise<T | undefined> {
    try {
        return await call()
    } catch (error) {
        if (error instanceof LimitsUnavailableError) return undefined
        throw error
    }
}

/**
 * Run a lookup by code against the network's allowance of wrong codes:
 * refused once 30 are spent; only an invalid code is counted, after the fact.
 *
 * A good code never touches the counter, so a class on one campus network
 * opening the same link at once is never refused for it (counting every
 * lookup up front and taking it back after would). The price: wrong codes
 * sent all at once may pass the check together and overshoot 30 by that
 * many; at 57⁸ codes that buys nothing.
 *
 * While the counter cannot be reached, lookups go on uncounted. The auth
 * limits refuse instead (D-137), since they guard short codes and passwords;
 * refusing here would stop every join while Redis is down. The global
 * throttler still counts every request per address.
 */
export async function countingGuesses<T>(limit: GuessLimitPort, ip: string, lookup: () => Promise<T>): Promise<T> {
    const state = await unlessDown(() => limit.check(INVITE_GUESSES_PER_NETWORK, ip))
    if (state?.limited) throw new InviteGuessesLimitedError(state.retryAfterSeconds)
    try {
        return await lookup()
    } catch (error) {
        if (error instanceof InviteInvalidError) await unlessDown(() => limit.hit(INVITE_GUESSES_PER_NETWORK, ip))
        throw error
    }
}
