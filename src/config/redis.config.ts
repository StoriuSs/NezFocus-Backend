import { registerAs } from '@nestjs/config'
import { parseIntSafe } from '@/shared/utils'

export default registerAs('redis', () => ({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseIntSafe(process.env.REDIS_PORT, 6379),
    password: process.env.REDIS_PASSWORD || undefined
}))
