import { ThrottlerStorage } from '@nestjs/throttler'
import { Injectable, Inject, Logger } from '@nestjs/common'
import { RedisClientType } from 'redis'
import { REDIS_CLIENT } from '../cache/redis-client.provider'
import { REPEATED_ERROR_LOG_INTERVAL_MS, throttledLog } from '@/shared/utils/log-throttle.util'

/**
 * Redis-backed throttler storage for distributed rate limiting.
 *
 * This deliberately talks to Redis directly rather than going through the
 * 2-layer cache:
 *
 * - **Atomicity.** Counting requires `INCR`. A get-then-set through the cache
 *   loses increments whenever two requests interleave, so a burst of N
 *   parallel requests can register as one.
 * - **Correctness across replicas.** An in-memory L1 layer would give every
 *   instance its own counter, making the effective limit `N x limit`.
 *
 * The window is *fixed*, not sliding: the TTL is set only when a counter is
 * first created. Refreshing it on every hit would mean a client that crosses
 * the limit and keeps knocking never falls out of the window, turning a
 * one-window throttle into an indefinite lockout.
 */
@Injectable()
export class KeyvThrottlerStorage implements ThrottlerStorage {
    /**
     * INCR the counter and set its expiry only on creation, then report the
     * remaining TTL. Done in one script so the whole read-increment-expire
     * sequence is atomic.
     */
    private static readonly INCREMENT_SCRIPT = `
        local hits = redis.call('INCR', KEYS[1])
        if hits == 1 then
            redis.call('PEXPIRE', KEYS[1], ARGV[1])
        end
        return { hits, redis.call('PTTL', KEYS[1]) }
    `

    private readonly logger = new Logger(KeyvThrottlerStorage.name)
    // Every request fails the same way while Redis is down.
    private readonly logUnavailable = throttledLog(
        (message) => this.logger.error(message),
        REPEATED_ERROR_LOG_INTERVAL_MS
    )

    constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClientType) {}

    async increment(
        key: string,
        ttl: number,
        limit: number,
        blockDuration: number,
        throttlerName: string
    ): Promise<{
        totalHits: number
        timeToExpire: number
        isBlocked: boolean
        timeToBlockExpire: number
    }> {
        const throttleKey = `throttle:${throttlerName}:${key}`
        const blockKey = `throttle:block:${throttlerName}:${key}`

        try {
            return await this.count(throttleKey, blockKey, ttl, limit, blockDuration)
        } catch (error) {
            // Fail OPEN. Rate limiting is a protective measure, not a
            // correctness gate — if Redis is unreachable, refusing every
            // request would turn a cache outage into a full outage. This guard
            // is the first one to run on every request, so it is exactly where
            // a hard dependency would be most damaging.
            this.logUnavailable(`Rate limit storage unavailable, allowing requests: ${error.message}`)
            return { totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }
        }
    }

    private async count(
        throttleKey: string,
        blockKey: string,
        ttl: number,
        limit: number,
        blockDuration: number
    ): Promise<{
        totalHits: number
        timeToExpire: number
        isBlocked: boolean
        timeToBlockExpire: number
    }> {
        // Check if currently blocked
        const blockedTtl = await this.redis.pTTL(blockKey)
        if (blockedTtl > 0) {
            const timeToBlockExpire = Math.ceil(blockedTtl / 1000)
            return {
                totalHits: limit + 1,
                timeToExpire: timeToBlockExpire,
                isBlocked: true,
                timeToBlockExpire
            }
        }

        const [hits, remainingMs] = (await this.redis.eval(KeyvThrottlerStorage.INCREMENT_SCRIPT, {
            keys: [throttleKey],
            arguments: [String(ttl)]
        })) as [number, number]

        // If exceeded limit, set block
        if (hits > limit && blockDuration > 0) {
            await this.redis.set(blockKey, '1', { PX: blockDuration })

            return {
                totalHits: hits,
                timeToExpire: Math.ceil(remainingMs / 1000),
                isBlocked: true,
                timeToBlockExpire: Math.ceil(blockDuration / 1000)
            }
        }

        return {
            totalHits: hits,
            timeToExpire: Math.ceil(remainingMs / 1000),
            isBlocked: false,
            timeToBlockExpire: 0
        }
    }

    /**
     * Reset every throttle key for an identifier — counters for all throttler
     * names plus their block keys.
     */
    async reset(key: string): Promise<void> {
        // Matches both `throttle:<name>:<key>` and `throttle:block:<name>:<key>`
        const pattern = `throttle:*${key}`
        const keysToDelete: string[] = []

        try {
            for await (const foundKey of this.redis.scanIterator({ MATCH: pattern, COUNT: 100 })) {
                keysToDelete.push(...(Array.isArray(foundKey) ? foundKey : [foundKey]))
            }

            if (keysToDelete.length > 0) {
                await this.redis.del(keysToDelete)
            }
        } catch (error) {
            this.logger.error(`Failed to reset rate limit counters: ${error.message}`)
        }
    }
}
