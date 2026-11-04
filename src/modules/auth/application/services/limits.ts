import { RateLimitedError } from '@/modules/auth/domain'
import { RateLimitRule, RateLimitState } from '../rate-limits'
import { RateLimitPort } from '../ports'

type Checks = [RateLimitRule, string][]

/** Refuse for the rule with the longest wait, naming why. */
function refuseOver(checks: Checks, states: RateLimitState[]): void {
    let worst = -1
    states.forEach((state, index) => {
        if (state.limited && (worst < 0 || state.retryAfterSeconds > states[worst].retryAfterSeconds)) worst = index
    })
    if (worst >= 0) throw new RateLimitedError(states[worst].retryAfterSeconds, checks[worst][0].reason)
}

/**
 * Refuse if any rule is used up; otherwise count a hit against each. A
 * refused request counts against nothing: pressing "send" again during the
 * one-minute wait must not use up the five an hour. (Two requests racing past
 * the check are still caught by the count.)
 */
export async function enforce(limiter: RateLimitPort, checks: Checks): Promise<void> {
    await refuseIfLimited(limiter, checks)
    refuseOver(checks, await Promise.all(checks.map(([rule, subject]) => limiter.hit(rule, subject))))
}

/** Refuse, without counting, if any rule is already used up. */
export async function refuseIfLimited(limiter: RateLimitPort, checks: Checks): Promise<void> {
    refuseOver(checks, await Promise.all(checks.map(([rule, subject]) => limiter.check(rule, subject))))
}

/** One guess at a password or a code, counted while it is checked (see withGuess). */
export interface Guess {
    /** The counts, with this guess and any others still being checked included. */
    readonly states: RateLimitState[]
    /** It was wrong: keep it counted. */
    wrong(): void
}

/**
 * Check a guess at a password or a code, with its limits counted first.
 *
 * Checking the count, then the guess, then counting a wrong one let a burst
 * through: a hundred requests sent at once all passed the check before the
 * first was counted, so a limit of five allowed a hundred guesses. Here each
 * guess holds a place in the count while it is checked, so the sixth of a
 * burst is refused. A guess gives its place back unless `wrong()` was called:
 * a right one, one refused by a limit, and one that never got as far as being
 * checked (a missing Turnstile, a password the rules turn down, an error)
 * count against nothing.
 */
export async function withGuess<T>(
    limiter: RateLimitPort,
    checks: Checks,
    check: (guess: Guess) => Promise<T>
): Promise<T> {
    const states = await Promise.all(checks.map(([rule, subject]) => limiter.hit(rule, subject)))
    let wrong = false
    try {
        refuseOver(checks, states)
        return await check({
            states,
            wrong: () => {
                wrong = true
            }
        })
    } finally {
        if (!wrong) await Promise.all(checks.map(([rule, subject]) => limiter.release(rule, subject)))
    }
}
