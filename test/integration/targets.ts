import { randomInt } from 'crypto'
import path from 'path'
import { config } from 'dotenv'

/**
 * Where the integration suites find their backing services.
 *
 * `pnpm test:services:up` starts them from docker-compose.dev.yaml with
 * .env.development, so the defaults come from that same file: a fresh clone
 * whose .env.development was copied from .env.example works with no extra
 * setup. Every value can still be overridden with a TEST_* variable (CI).
 *
 * The defaults used to be one developer's personal port and password, so on
 * any other machine the suites could not reach Redis.
 */
const dev: Record<string, string> =
    config({ path: path.resolve(__dirname, '../../.env.development'), processEnv: {}, quiet: true }).parsed ?? {}

const env = process.env

export const redisTarget = {
    host: env.TEST_REDIS_HOST ?? 'localhost',
    port: Number(env.TEST_REDIS_PORT ?? dev.REDIS_PORT ?? 6379),
    password: env.TEST_REDIS_PASSWORD ?? dev.REDIS_PASSWORD ?? ''
}

/**
 * A separate `<DB_NAME>_test` database on the dev Postgres, created and
 * migrated by global-setup.ts — the suites never touch development data.
 */
const dbName = `${dev.DB_NAME ?? 'app'}_test`
const dbCredentials = `${encodeURIComponent(dev.DB_USERNAME ?? 'postgres')}:${encodeURIComponent(dev.DB_PASSWORD ?? 'postgres')}`
const dbPort = dev.DB_PORT ?? '5432'

export const databaseTarget = {
    url: env.TEST_DATABASE_URL ?? `postgresql://${dbCredentials}@localhost:${dbPort}/${dbName}`,
    /** The server's default database, used only to create the test database. */
    maintenanceUrl: env.TEST_DATABASE_MAINTENANCE_URL ?? `postgresql://${dbCredentials}@localhost:${dbPort}/postgres`
}

const s3Endpoint = env.TEST_S3_ENDPOINT ?? 'http://localhost:9100'

export const s3Target = {
    endpoint: s3Endpoint,
    bucket: env.TEST_S3_BUCKET ?? 'avatars-test',
    accessKey: env.TEST_S3_ACCESS_KEY ?? 'rustfsadmin',
    secretKey: env.TEST_S3_SECRET_KEY ?? 'rustfsadmin123'
}

export const smtpTarget = {
    // Not 'localhost': nodemailer picks one of its addresses at random, and
    // Docker publishes Mailpit on 127.0.0.1 only, so a pick of ::1 is refused
    // and the email arrives on a retry, after the tests stopped waiting.
    host: env.TEST_SMTP_HOST ?? '127.0.0.1',
    port: Number(env.TEST_SMTP_PORT ?? 1025),
    apiUrl: env.TEST_MAILPIT_API ?? `http://localhost:${env.TEST_MAILPIT_UI_PORT ?? 8025}`
}

/**
 * A made-up client address for one suite (sent as X-Forwarded-For). The
 * sign-in limits count per IP for 15 minutes in Redis, which outlives a run:
 * from a handful of addresses, a quick rerun often drew one an earlier run
 * had used up, and sign-in asked for Turnstile. A private 10.x.x.x address
 * makes a repeat a one-in-millions event.
 */
export const testClientIp = () => `10.${randomInt(0, 256)}.${randomInt(0, 256)}.${randomInt(1, 255)}`

const hex16 = () => randomInt(0, 0x10000).toString(16)

/**
 * A made-up IPv6 /64 (in the 2001:db8::/32 documentation range), as a
 * function that returns a new address inside it on every call: an IPv6
 * client can pick a fresh one for each request.
 */
export const testIPv6Network = () => {
    const network = `2001:db8:${hex16()}:${hex16()}`
    return () => `${network}:${hex16()}:${hex16()}:${hex16()}:${hex16()}`
}
