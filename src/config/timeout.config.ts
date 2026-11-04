import { registerAs } from '@nestjs/config'
import { parseIntSafe } from '@/shared/utils'

export default registerAs('timeout', () => ({
    requestTimeout: parseIntSafe(process.env.REQUEST_TIMEOUT_MS, 30000) // 30 seconds default
}))
