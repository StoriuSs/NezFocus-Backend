import { Module, Global } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { CacheModule as NestCacheModule } from '@nestjs/cache-manager'
import { Keyv } from 'keyv'
import KeyvRedis from '@keyv/redis'
import { CacheableMemory } from 'cacheable'
import cacheConfig from '@/config/cache.config'
import { CacheCleanupService } from './cache-cleanup.service'
import { redisClientProvider, RedisClientCleanupService, REDIS_CLIENT } from './redis-client.provider'
import { RateLimiter } from '../rate-limit/rate-limiter'

/**
 * Global cache module providing a 2-layer caching system.
 *
 * **Architecture:**
 * - Layer 1 (L1): In-memory LRU cache using CacheableMemory
 *   - Fast: sub-millisecond access
 *   - Per-instance: each app instance has its own L1
 *   - Limited: LRU eviction based on lruSize
 *
 * - Layer 2 (L2): Redis cache using KeyvRedis
 *   - Distributed: shared across all instances
 *   - Persistent: survives app restarts
 *   - Slower: 2-5ms network latency
 *
 * **Cache Lookup Flow:**
 * 1. Check L1 (in-memory) → Found? Return immediately
 * 2. Check L2 (Redis) → Found? Return + promote to L1
 * 3. Not found → Query source + store in both layers
 *
 * **Benefits:**
 * - 4-10x faster for cached data (most hits from L1)
 * - Reduces Redis network calls by 70-90%
 * - Distributes load across instances via L2
 *
 * **Usage:**
 * ```typescript
 * constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}
 *
 * await this.cache.get(key)
 * await this.cache.set(key, value, ttl)
 * await this.cache.del(key)
 * ```
 */
@Global()
@Module({
    imports: [
        NestCacheModule.registerAsync({
            imports: [ConfigModule.forFeature(cacheConfig)],
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => {
                // Build Redis connection URL
                // The password is percent-encoded: one containing @, / or :
                // otherwise breaks the URL and the Redis layer never connects.
                const password = configService.get<string>('redis.password')
                const credentials = password ? `:${encodeURIComponent(password)}@` : ''
                const redisUrl = `redis://${credentials}${configService.get<string>('redis.host')}:${configService.get<number>('redis.port')}`

                return {
                    stores: [
                        // L1: In-memory LRU cache (fast, per-instance)
                        new Keyv({
                            store: new CacheableMemory({
                                ttl: configService.get<number>('cache.ttl')! * 1000, // Convert to ms
                                lruSize: configService.get<number>('cache.lruSize')
                            })
                        }),
                        // L2: Redis cache (distributed, persistent)
                        new KeyvRedis(redisUrl)
                    ]
                }
            }
        })
    ],
    providers: [CacheCleanupService, redisClientProvider, RedisClientCleanupService, RateLimiter],
    exports: [NestCacheModule, REDIS_CLIENT, RateLimiter]
})
export class CacheModule {}
