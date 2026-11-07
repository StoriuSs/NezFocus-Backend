import type { RedisClientType } from 'redis'
import { LimitsUnavailableError } from '@/shared/domain'
import { RateLimiter } from './rate-limiter'

/** A Redis that cannot be reached: every command fails. */
function unreachableRedis(): RedisClientType {
    const fail = () => Promise.reject(new Error('connect ECONNREFUSED'))
    return { eval: fail, get: fail, pTTL: fail, del: fail } as unknown as RedisClientType
}

const RULE = { name: 'code-try-ip', limit: 30, windowMs: 300_000 }

describe('RateLimiter without Redis (D-137)', () => {
    it('refuses rather than allowing, when a hit cannot be counted', async () => {
        const limiter = new RateLimiter(unreachableRedis())

        const refused = await limiter.hit(RULE, '203.0.113.7').catch((e: unknown) => e)

        expect(refused).toBeInstanceOf(LimitsUnavailableError)
        expect((refused as LimitsUnavailableError).kind).toBe('unavailable')
    })

    it('refuses rather than allowing, when a count cannot be read', async () => {
        const limiter = new RateLimiter(unreachableRedis())

        await expect(limiter.check(RULE, 'ada@example.test')).rejects.toBeInstanceOf(LimitsUnavailableError)
    })

    it('lets a release or a reset fail quietly: neither lets anything through', async () => {
        const limiter = new RateLimiter(unreachableRedis())

        await expect(limiter.release(RULE, 'ada@example.test')).resolves.toBeUndefined()
        await expect(limiter.reset(RULE, 'ada@example.test')).resolves.toBeUndefined()
    })
})
