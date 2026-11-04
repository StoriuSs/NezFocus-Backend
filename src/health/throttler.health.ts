import { Injectable, Inject } from '@nestjs/common'
import { HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus'
import { RedisClientType } from 'redis'
import { REDIS_CLIENT } from '@/shared/infrastructure/cache/redis-client.provider'
import { failureDetail } from './failure-detail'

/**
 * Health check indicator for the rate limiting system.
 *
 * Exercises the same Redis store the throttler writes its counters to, using
 * the same primitive (an expiring INCR), so a Redis outage or a read-only
 * replica surfaces here rather than as silently unlimited request rates.
 */
@Injectable()
export class ThrottlerHealthIndicator extends HealthIndicator {
    constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClientType) {
        super()
    }

    /**
     * Checks if the throttler's Redis storage is healthy.
     *
     * @param key - The key name for the health check result
     * @returns Health check result indicating if throttler storage is operational
     */
    async pingCheck(key: string): Promise<HealthIndicatorResult> {
        try {
            // Mirror what the throttler actually does — a counter write with an
            // expiry — rather than a plain read, so a writable-Redis failure is
            // caught too. Probing the 2-layer cache would not work here: the L1
            // memory layer answers the read before Redis is consulted.
            const probeKey = '__throttler_health_check__'
            const hits = await this.redis.incr(probeKey)
            await this.redis.pExpire(probeKey, 1000)

            if (hits > 0) {
                return this.getStatus(key, true)
            }
            return this.getStatus(key, false, failureDetail(new Error('Throttler storage returned no counter')))
        } catch (error) {
            return this.getStatus(key, false, failureDetail(error))
        }
    }
}
