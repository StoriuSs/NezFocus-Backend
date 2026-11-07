import { registerAs } from '@nestjs/config'
import { parseIntSafe } from '@/shared/utils'

export default registerAs('throttle', () => ({
    ttl: parseIntSafe(process.env.THROTTLE_TTL, 60),
    /** Per route, per signed-in user. */
    limit: parseIntSafe(process.env.THROTTLE_LIMIT, 100),
    /** Per route, per IP network, for requests without a valid access token (D-135). */
    anonymousLimit: parseIntSafe(process.env.THROTTLE_ANONYMOUS_LIMIT, 300)
}))
