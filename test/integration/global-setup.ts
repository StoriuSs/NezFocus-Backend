import { connect } from 'net'
import { execSync } from 'child_process'
import { Client } from 'pg'
import { databaseTarget, redisTarget, s3Target, smtpTarget } from './targets'

/**
 * Confirms every backing service is reachable before any suite starts, then
 * prepares the test database.
 *
 * Without the reachability check, a missing service shows up as a string of
 * timeouts deep inside individual tests, which reads like a bug in the code
 * under test rather than "the container isn't running".
 */
interface Service {
    name: string
    host: string
    port: number
}

const s3Endpoint = new URL(s3Target.endpoint)
const database = new URL(databaseTarget.url)

const services: Service[] = [
    { name: 'Postgres', host: database.hostname, port: Number(database.port || 5432) },
    { name: 'Redis', host: redisTarget.host, port: redisTarget.port },
    { name: 'RustFS (S3)', host: s3Endpoint.hostname, port: Number(s3Endpoint.port || 80) },
    { name: 'Mailpit (SMTP)', host: smtpTarget.host, port: smtpTarget.port }
]

const reachable = ({ host, port }: Service): Promise<boolean> =>
    new Promise((resolve) => {
        const socket = connect({ host, port })
        const done = (ok: boolean) => {
            socket.destroy()
            resolve(ok)
        }
        socket.setTimeout(3000, () => done(false))
        socket.once('connect', () => done(true))
        socket.once('error', () => done(false))
    })

/**
 * A just-started Postgres accepts TCP connections before it accepts sessions
 * ("the database system is starting up"), so retry for a little while.
 */
async function connectWhenReady(): Promise<Client> {
    for (let attempt = 1; ; attempt++) {
        const client = new Client({ connectionString: databaseTarget.maintenanceUrl })
        try {
            await client.connect()
            return client
        } catch (error) {
            await client.end().catch(() => undefined)
            if (attempt >= 30) throw error
            await new Promise((resolve) => setTimeout(resolve, 1000))
        }
    }
}

/** Creates the test database if needed and applies every migration to it. */
async function prepareDatabase(): Promise<void> {
    const name = database.pathname.slice(1)
    const client = await connectWhenReady()
    try {
        const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])
        if (!rowCount) {
            // Identifiers can't be bound as parameters; the name comes from
            // our own env file, and is quoted.
            await client.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`)
        }
    } finally {
        await client.end()
    }

    // The same migrations production runs, so schema drift fails here first.
    execSync('pnpm exec prisma migrate deploy', {
        env: { ...process.env, DATABASE_URL: databaseTarget.url },
        stdio: 'pipe'
    })
}

export default async function integrationGlobalSetup(): Promise<void> {
    const results = await Promise.all(services.map(async (service) => ({ ...service, ok: await reachable(service) })))
    const down = results.filter((result) => !result.ok)

    if (down.length > 0) {
        const list = down.map((service) => `  - ${service.name} at ${service.host}:${service.port}`).join('\n')
        throw new Error(
            `Integration tests need backing services that are not reachable:\n${list}\n\n` +
                'Start them with:  pnpm test:services:up'
        )
    }

    await prepareDatabase()
}
