import { registerAs } from '@nestjs/config'
import { parseIntSafe } from '@/shared/utils'

/**
 * Helper to safely parse integer from potentially undefined string
 */
export default registerAs('cache', () => ({
    ttl: parseIntSafe(process.env.CACHE_TTL, 3600),
    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseIntSafe(process.env.REDIS_PORT, 6379),
        password: process.env.REDIS_PASSWORD || undefined
    },
    lruSize: parseIntSafe(process.env.CACHE_LRU_SIZE, 500)
}))
