import { registerAs } from '@nestjs/config'
import { parseIntSafe } from '@/shared/utils'

export default registerAs('database', () => ({
    // The only way the app and Prisma connect. In Docker the compose files
    // build it from DB_USERNAME, DB_PASSWORD and DB_NAME with the host db.
    url: process.env.DATABASE_URL,

    // Connection pool sizing. The default `pg` pool is 10 connections; make it
    // explicit so it can be tuned against Postgres' max_connections when
    // running more than one replica.
    poolMax: parseIntSafe(process.env.DB_POOL_MAX, 10),
    poolIdleTimeoutMs: parseIntSafe(process.env.DB_POOL_IDLE_TIMEOUT_MS, 30000),
    poolConnectionTimeoutMs: parseIntSafe(process.env.DB_POOL_CONNECTION_TIMEOUT_MS, 10000)
}))
