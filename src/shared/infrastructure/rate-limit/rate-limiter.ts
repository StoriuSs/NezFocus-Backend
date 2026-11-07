import { Inject, Injectable, Logger } from '@nestjs/common'
import { createHash } from 'crypto'
import { RedisClientType } from 'redis'
import { REDIS_CLIENT } from '../cache/redis-client.provider'
import { REPEATED_ERROR_LOG_INTERVAL_MS, throttledLog } from '@/shared/utils/log-throttle.util'
import { ipNetwork } from '@/shared/utils/ip-network.util'
import { RateLimitRule, RateLimitState } from '@/shared/types/rate-limit.type'
import { LimitsUnavailableError } from '@/shared/domain'

/**
 * INCR, and start the window on the first hit, as one step. Two separate calls
 * (as the old helper made, through the two-layer cache) could both read the
 * same count and both let a request through, or leave a counter with no expiry
 * that never resets. The PTTL check repairs a key that has lost its expiry.
 */
const HIT = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {n, ttl}
`

/** DECR, but never below zero, and never creating a key that has expired. */
const RELEASE = `
local n = tonumber(redis.call('GET', KEYS[1]) or '0')
if n > 0 then return redis.call('DECR', KEYS[1]) end
return 0
`

/**
 * Fixed-window counters in Redis, shared by every app instance.
 *
 * For limits that belong to one operation — sign-in failures per address,
 * verification emails per address — where the global throttler (per IP, every
 * route) is too blunt. Subjects are hashed into the key, so no email address
 * sits in Redis in clear. A subject that is an IPv6 address counts per /64
 * (ipNetwork): a client can use a new address of its /64 for every request.
 *
 * **Fails closed** (D-137). If Redis cannot be reached, `hit` and `check`
 * throw LimitsUnavailableError (503) and the failure is logged (once a
 * minute). These limits are what stops guessing at codes and passwords, and
 * letting requests through uncounted during an outage would open exactly
 * that: a new code every request, five guesses each. Signing in stops until
 * Redis is back (the RedisDown alert covers it); signed-in sessions go on.
 * `release` and `reset` only log: failing them lets nothing extra through.
 * The global throttler, which counts every route, still fails open.
 */
@Injectable()
export class RateLimiter {
    private readonly logger = new Logger(RateLimiter.name)
    private readonly logFailure = throttledLog((message) => this.logger.error(message), REPEATED_ERROR_LOG_INTERVAL_MS)

    constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClientType) {}

    static key(rule: RateLimitRule, subject: string): string {
        const digest = createHash('sha256').update(ipNetwork(subject).toLowerCase()).digest('hex')
        return `rl:${rule.name}:${digest}`
    }

    /** Count one hit, and say whether the subject is now over the limit. */
    async hit(rule: RateLimitRule, subject: string): Promise<RateLimitState> {
        try {
            const [count, ttlMs] = (await this.redis.eval(HIT, {
                keys: [RateLimiter.key(rule, subject)],
                arguments: [String(rule.windowMs)]
            })) as [number, number]
            return { count, limited: count > rule.limit, retryAfterSeconds: Math.ceil(ttlMs / 1000) }
        } catch (error) {
            throw this.unavailable(error)
        }
    }

    /** Whether the subject has already used up the limit, without counting a hit. */
    async check(rule: RateLimitRule, subject: string): Promise<RateLimitState> {
        try {
            const key = RateLimiter.key(rule, subject)
            const [raw, ttlMs] = await Promise.all([this.redis.get(key), this.redis.pTTL(key)])
            const count = raw ? Number(raw) : 0
            return {
                count,
                limited: count >= rule.limit,
                retryAfterSeconds: ttlMs > 0 ? Math.ceil(ttlMs / 1000) : 0
            }
        } catch (error) {
            throw this.unavailable(error)
        }
    }

    /** Take back one hit: an attempt counted before it ran, that turned out not to count. */
    async release(rule: RateLimitRule, subject: string): Promise<void> {
        try {
            await this.redis.eval(RELEASE, { keys: [RateLimiter.key(rule, subject)] })
        } catch (error) {
            this.logFailure(`Rate limiting unavailable: ${(error as Error)?.message}`)
        }
    }

    /** Forget the subject's hits — after a successful sign-in, say. */
    async reset(rule: RateLimitRule, subject: string): Promise<void> {
        try {
            await this.redis.del(RateLimiter.key(rule, subject))
        } catch (error) {
            this.logFailure(`Rate limiting unavailable: ${(error as Error)?.message}`)
        }
    }

    private unavailable(error: unknown): LimitsUnavailableError {
        this.logFailure(`Rate limiting unavailable, refusing the request: ${(error as Error)?.message}`)
        return new LimitsUnavailableError()
    }
}
