// Turns two-step sign-in off for an account, from the command line: for
// someone who lost both their phone and their recovery codes (once you are
// sure, by other means, that it is them), or for everyone whose secret can
// no longer be read because AUTH_ENCRYPTION_KEY was lost.
//
//   pnpm auth:two-factor:off ada@example.com
//   pnpm auth:two-factor:off --unreadable           list who it would be
//   pnpm auth:two-factor:off --unreadable --yes     and do it
//
// On a server, in the app's container:
//
//   docker compose --env-file .env.production -f docker-compose.prod.yaml exec app \
//     node dist/src/bootstrap/two-factor-off.js ada@example.com
//
// The owner is emailed that two-step sign-in was turned off, as when they do
// it themselves: if it was not their request, they know at once. Their
// password and sessions are left as they are; they can turn it on again in
// settings.
import '../config/load-env'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { Queue } from 'bullmq'
import { PrismaClient } from '../../generated/prisma/client'
import { QUEUES } from '@/shared/infrastructure/queue/queues'
import { AUTH_JOBS, EMAIL_JOB_OPTIONS, TwoFactorChangedJob } from '@/modules/auth/infrastructure/email/auth-email-jobs'
import { AesSecretBox } from '@/modules/auth/infrastructure/adapters/aes-secret-box.adapter'
import { encryptionKeysFromEnv } from './rotate-encryption-key'

const USAGE = 'Usage: pnpm auth:two-factor:off <email>  |  pnpm auth:two-factor:off --unreadable [--yes]'

export type OffCommand = { email: string } | { unreadable: true; yes: boolean }

export function parseArgs(argv: string[]): OffCommand {
    const args = argv.filter((arg) => arg !== '--')
    if (args.includes('--unreadable')) {
        const unknown = args.filter((arg) => arg !== '--unreadable' && arg !== '--yes')
        if (unknown.length > 0) throw new Error(USAGE)
        return { unreadable: true, yes: args.includes('--yes') }
    }
    if (args.length !== 1 || !args[0].includes('@') || args[0].startsWith('--')) throw new Error(USAGE)
    return { email: args[0].trim().toLowerCase() }
}

type Prisma = Pick<PrismaClient, 'user' | 'twoFactor' | 'recoveryCode' | '$transaction'>

export interface Account {
    userId: string
    email: string | null
}

/** The account with this address that has two-step sign-in (on, or being set up). */
export async function accountByEmail(prisma: Prisma, email: string): Promise<Account> {
    const user = await prisma.user.findFirst({
        where: { email, deletedAt: null },
        select: { id: true, email: true, twoFactor: { select: { userId: true } } }
    })
    if (!user) throw new Error(`No account uses ${email}`)
    if (!user.twoFactor) throw new Error(`${email} does not have two-step sign-in on`)
    return { userId: user.id, email: user.email }
}

/** Accounts whose secret no configured key opens: they cannot finish signing in. */
export async function unreadableAccounts(prisma: Prisma, box: AesSecretBox): Promise<Account[]> {
    const rows = await prisma.twoFactor.findMany({
        select: { userId: true, secretSealed: true, user: { select: { email: true } } }
    })
    return rows
        .filter((row) => {
            try {
                box.open(row.secretSealed)
                return false
            } catch {
                return true
            }
        })
        .map((row) => ({ userId: row.userId, email: row.user.email }))
}

/** Removes the secret and every recovery code, as turning it off in settings does. */
export async function turnOff(prisma: Prisma, userId: string): Promise<void> {
    await prisma.$transaction([
        prisma.recoveryCode.deleteMany({ where: { userId } }),
        prisma.twoFactor.deleteMany({ where: { userId } })
    ])
}

/** Queues the "turned off" email, as the app does; the app's worker sends it. */
export async function queueTurnedOffEmail(queue: Pick<Queue, 'add'>, to: string): Promise<void> {
    const job: TwoFactorChangedJob = { to, enabled: false }
    await queue.add(AUTH_JOBS.TWO_FACTOR_CHANGED, job, EMAIL_JOB_OPTIONS)
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('Redis did not answer')), ms)
            })
        ])
    } finally {
        clearTimeout(timer)
    }
}

async function main(): Promise<void> {
    const command = parseArgs(process.argv.slice(2))
    const pool = new Pool({ connectionString: process.env.DATABASE_URL })
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
    let queue: Queue | undefined
    try {
        const accounts =
            'email' in command
                ? [await accountByEmail(prisma, command.email)]
                : await unreadableAccounts(prisma, new AesSecretBox(encryptionKeysFromEnv()))

        if ('unreadable' in command) {
            if (accounts.length === 0) {
                console.log('✓ Every two-step secret can be read with the configured keys. Nothing to do.')
                return
            }
            console.log(`${accounts.length} account(s) cannot finish signing in:`)
            for (const account of accounts) console.log(`    ${account.email ?? account.userId}`)
            if (!command.yes) {
                console.log('Nothing changed. To turn two-step sign-in off for them, add --yes.')
                return
            }
        }

        queue = new Queue(QUEUES.AUTH, {
            connection: {
                host: process.env.REDIS_HOST || 'localhost',
                port: Number(process.env.REDIS_PORT || 6379),
                password: process.env.REDIS_PASSWORD || undefined,
                // Fail rather than wait forever: the change is made either way.
                maxRetriesPerRequest: 1,
                enableOfflineQueue: false
            }
        })
        queue.on('error', () => undefined)

        for (const account of accounts) {
            await turnOff(prisma, account.userId)
            const who = account.email ?? account.userId
            if (!account.email) {
                console.log(`✓ ${who}: two-step sign-in is off (no address to email).`)
                continue
            }
            try {
                await withTimeout(queueTurnedOffEmail(queue, account.email), 5000)
                console.log(`✓ ${who}: two-step sign-in is off, and they are emailed.`)
            } catch {
                console.warn(`⚠ ${who}: two-step sign-in is off, but the email could not be queued (Redis). Tell them.`)
            }
        }
    } finally {
        await queue?.close().catch(() => undefined)
        await prisma.$disconnect()
        await pool.end()
    }
}

if (require.main === module) {
    main().catch((error: Error) => {
        console.error(`✗ ${error.message}`)
        process.exit(1)
    })
}
