import { RateLimitedError } from '@/modules/auth/domain'
import { AUTH_RATE_LIMITS, RateLimitRule, RateLimitState } from '../rate-limits'
import { RateLimitPort } from '../ports'
import { enforce, withGuess } from './limits'

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

const { currentPasswordFailuresPerUser: perUser } = AUTH_RATE_LIMITS

/** A check that takes a moment, like a password hash: long enough for a burst to overlap. */
const slowly = () => new Promise((resolve) => setTimeout(resolve, 5))

describe('withGuess', () => {
    it('keeps a wrong guess counted, and gives a right one its place back', async () => {
        const limiter = new Limiter()
        await expect(
            withGuess(limiter, [[perUser, 'ada']], async (guess) => {
                guess.wrong()
                throw new Error('wrong code')
            })
        ).rejects.toThrow('wrong code')
        await expect(withGuess(limiter, [[perUser, 'ada']], async () => 'signed in')).resolves.toBe('signed in')
        expect(limiter.counts.get(`${perUser.name}:ada`)).toBe(1)
    })

    it('lets only as many guesses of a burst through as the limit allows', async () => {
        const limiter = new Limiter()
        let checked = 0
        const results = await Promise.allSettled(
            Array.from({ length: 50 }, () =>
                withGuess(limiter, [[perUser, 'ada']], async (guess) => {
                    checked++
                    await slowly()
                    guess.wrong()
                    throw new Error('wrong code')
                })
            )
        )
        expect(checked).toBe(perUser.limit)
        expect(results.filter((r) => r.status === 'rejected' && r.reason instanceof RateLimitedError)).toHaveLength(
            50 - perUser.limit
        )
        expect(limiter.counts.get(`${perUser.name}:ada`)).toBe(perUser.limit)
    })
})

describe('enforce', () => {
    const { codeEmailsPerEmailMinute: minute, codeEmailsPerEmailHour: hour } = AUTH_RATE_LIMITS

    it('counts only the requests it lets through when a burst races past the check', async () => {
        const limiter = new Limiter()
        const checks: [RateLimitRule, string][] = [
            [minute, 'ada'],
            [hour, 'ada']
        ]

        // A double click, or six at once: one email goes out.
        const outcomes = await Promise.all(
            Array.from({ length: 6 }, () =>
                enforce(limiter, checks).then(
                    () => 'sent',
                    (e: unknown) => e
                )
            )
        )

        expect(outcomes.filter((o) => o === 'sent')).toHaveLength(1)
        expect(outcomes.filter((o) => o instanceof RateLimitedError)).toHaveLength(5)
        // The hour still has four emails left, as for one email sent.
        expect(limiter.counts.get(`${hour.name}:ada`)).toBe(1)
        expect(limiter.counts.get(`${minute.name}:ada`)).toBe(1)
    })
})
