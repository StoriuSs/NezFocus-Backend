import { RateLimitedError } from '@/modules/auth/domain'
import { AUTH_RATE_LIMITS, RateLimitRule, RateLimitState } from '../rate-limits'
import { RateLimitPort } from '../ports'
import { withGuess } from './limits'

/** Counts in memory like the shared RateLimiter. */
class Limiter implements RateLimitPort {
    counts = new Map<string, number>()
    private key = (rule: RateLimitRule, subject: string) => `${rule.name}:${subject}`
    async hit(rule: RateLimitRule, subject: string): Promise<RateLimitState> {
        const count = (this.counts.get(this.key(rule, subject)) ?? 0) + 1
        this.counts.set(this.key(rule, subject), count)
        return { count, limited: count > rule.limit, retryAfterSeconds: rule.windowMs / 1000 }
    }
    async check(rule: RateLimitRule, subject: string): Promise<RateLimitState> {
        const count = this.counts.get(this.key(rule, subject)) ?? 0
        return { count, limited: count >= rule.limit, retryAfterSeconds: rule.windowMs / 1000 }
    }
    async release(rule: RateLimitRule, subject: string) {
        const count = this.counts.get(this.key(rule, subject)) ?? 0
        if (count > 0) this.counts.set(this.key(rule, subject), count - 1)
    }
    async reset(rule: RateLimitRule, subject: string) {
        this.counts.delete(this.key(rule, subject))
    }
}

const { twoFactorFailuresPerUser: twoStep } = AUTH_RATE_LIMITS

/** A check that takes a moment, like a password hash: long enough for a burst to overlap. */
const slowly = () => new Promise((resolve) => setTimeout(resolve, 5))

describe('withGuess', () => {
    it('keeps a wrong guess counted, and gives a right one its place back', async () => {
        const limiter = new Limiter()
        await expect(
            withGuess(limiter, [[twoStep, 'ada']], async (guess) => {
                guess.wrong()
                throw new Error('wrong code')
            })
        ).rejects.toThrow('wrong code')
        await expect(withGuess(limiter, [[twoStep, 'ada']], async () => 'signed in')).resolves.toBe('signed in')
        expect(limiter.counts.get(`${twoStep.name}:ada`)).toBe(1)
    })

    it('lets only as many guesses of a burst through as the limit allows', async () => {
        const limiter = new Limiter()
        let checked = 0
        const results = await Promise.allSettled(
            Array.from({ length: 50 }, () =>
                withGuess(limiter, [[twoStep, 'ada']], async (guess) => {
                    checked++
                    await slowly()
                    guess.wrong()
                    throw new Error('wrong code')
                })
            )
        )
        expect(checked).toBe(twoStep.limit)
        expect(results.filter((r) => r.status === 'rejected' && r.reason instanceof RateLimitedError)).toHaveLength(
            50 - twoStep.limit
        )
        expect(limiter.counts.get(`${twoStep.name}:ada`)).toBe(twoStep.limit)
    })
})
