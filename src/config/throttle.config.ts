import { registerAs } from '@nestjs/config'
import { parseIntSafe } from '@/shared/utils'

export default registerAs('throttle', () => ({
    ttl: parseIntSafe(process.env.THROTTLE_TTL, 60),
    limit: parseIntSafe(process.env.THROTTLE_LIMIT, 100)
}))
