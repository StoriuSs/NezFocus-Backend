import { randomUUID } from 'crypto'
import { createClient, RedisClientType } from 'redis'
import { RateLimiter } from '@/shared/infrastructure/rate-limit/rate-limiter'
import { RateLimitRule } from '@/shared/types'
import { redisTarget } from './targets'

/**
 * The limiter every auth limit stands on, against a real Redis: it must hold
 * under concurrency (the helper it replaced read and wrote in separate steps).
 *
 * Requires Redis: `pnpm test:services:up`, then `pnpm test:integration`.
 */
describe('RateLimiter (integration)', () => {
    let redis: RedisClientType
    let limiter: RateLimiter
    const prefix = `itest-${randomUUID().slice(0, 8)}`

    beforeAll(async () => {
        redis = createClient({
            socket: { host: redisTarget.host, port: redisTarget.port },
            password: redisTarget.password || undefined
        })
        await redis.connect()
        limiter = new RateLimiter(redis)
    })

    afterAll(async () => {
        for await (const keys of redis.scanIterator({ MATCH: `rl:${prefix}*`, COUNT: 100 })) {
            if (keys.length) await redis.del(keys)
        }
        await redis.quit()
    })

    const rule = (limit: number): RateLimitRule => ({
        name: `${prefix}-${randomUUID().slice(0, 4)}`,
        limit,
        windowMs: 60_000
    })

    it('lets exactly `limit` hits through when 50 arrive at once, and takes back one hit on release', async () => {
        const five = rule(5)
        const results = await Promise.all(Array.from({ length: 50 }, () => limiter.hit(five, 'a@example.test')))
        expect(results.filter((r) => !r.limited)).toHaveLength(5)
        expect(new Set(results.map((r) => r.count)).size).toBe(50)

        const two = rule(2)
        await limiter.hit(two, 's')
        await limiter.hit(two, 's')
        await limiter.release(two, 's')
        expect((await limiter.check(two, 's')).count).toBe(1)
        // The window is kept: a release never makes a counter that lasts for ever.
        expect(await redis.pTTL(RateLimiter.key(two, 's'))).toBeGreaterThan(0)
        await limiter.release(two, 's')
        await limiter.release(two, 's')
        expect((await limiter.check(two, 's')).count).toBe(0)
    })
})
