import { registerAs } from '@nestjs/config'
import { parseIntSafe } from '@/shared/utils'

export default registerAs('app', () => ({
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000', 10),
    // Just the prefix — URI versioning appends /v1 itself, so a default of
    // 'api/v1' would produce /api/v1/v1/*.
    apiPrefix: process.env.API_PREFIX || 'api',
    name: process.env.APP_NAME || 'Test App',
    baseUrl: process.env.BASE_URL || `http://localhost:${parseInt(process.env.PORT || '3000', 10)}`,
    // Where the web app lives: links in emails point there. No trailing slash.
    frontendUrl: (process.env.FRONTEND_URL || 'http://localhost:3001').replace(/\/+$/, ''),
    // Where people can ask for help; named in the emails that need a person
    // to step in. Empty: those emails say "contact support" without an address.
    supportEmail: process.env.SUPPORT_EMAIL?.trim() || null,
    gracefulShutdownTimeout: parseIntSafe(process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS, 5000), // 5s default
    // Dev-only fallbacks. In production the app refuses to boot with a weak or
    // default BULL_BOARD_PASSWORD (validation.ts): /admin/queues is mounted on
    // raw Express outside every guard, so admin/admin would open the auth
    // queue to anyone who reaches it: a waiting or failed email job holds the
    // sign-in code it sends, and a job can be retried or removed from there.
    bullBoardUser: process.env.BULL_BOARD_USER || 'admin',
    bullBoardPassword: process.env.BULL_BOARD_PASSWORD || 'admin',
    // Days a deleted account keeps its personal data before the maintenance
    // sweep erases it.
    deletedAccountRetentionDays: parseIntSafe(process.env.DELETED_ACCOUNT_RETENTION_DAYS, 30)
}))
