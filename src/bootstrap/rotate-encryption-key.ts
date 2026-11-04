// Seals every two-step sign-in secret again with the current
// AUTH_ENCRYPTION_KEY, and says what still needs the previous key. The last
// step of changing the key (docs/auth/operations.md, "Changing the encryption key"):
//
//   1. AUTH_ENCRYPTION_KEY_PREVIOUS = the old key, AUTH_ENCRYPTION_KEY = a new
//      one (openssl rand -hex 32); deploy. Everyone keeps signing in.
//   2. pnpm auth:rotate-key
//   3. Empty AUTH_ENCRYPTION_KEY_PREVIOUS when this says nothing needs it.
//
// On a server, in the app's container:
//
//   docker compose --env-file .env.production -f docker-compose.prod.yaml exec app \
//     node dist/src/bootstrap/rotate-encryption-key.js
//
// Safe to run any number of times, and while the app serves requests: a
// secret is replaced only if it is still the one read.
import '../config/load-env'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../generated/prisma/client'
import { SealedWithUnknownKeyError } from '@/modules/auth/application/ports'
import { AesSecretBox, EncryptionKeys } from '@/modules/auth/infrastructure/adapters/aes-secret-box.adapter'

/** AUTH_ENCRYPTION_KEY and AUTH_ENCRYPTION_KEY_PREVIOUS, as the app reads them. */
export function encryptionKeysFromEnv(env: NodeJS.ProcessEnv = process.env): EncryptionKeys {
    const current = env.AUTH_ENCRYPTION_KEY?.trim()
    if (!current) throw new Error('AUTH_ENCRYPTION_KEY is not set')
    const previous = env.AUTH_ENCRYPTION_KEY_PREVIOUS?.trim()
    return previous ? { current, previous } : { current }
}

export interface UnreadableAccount {
    userId: string
    email: string | null
    /** `unknown-key`: sealed with a key not configured here. `damaged`: altered or corrupt. */
    reason: 'unknown-key' | 'damaged'
}

export interface RotationReport {
    /** Accounts with a two-step secret (on, or being set up). */
    secrets: number
    /** Sealed again with the current key by this run. */
    resealed: number
    unreadable: UnreadableAccount[]
    /** Accounts with unused recovery codes made with the previous key: they stop working without it. */
    codesOnPreviousKey: number
    /** …made with a key configured nowhere here: they cannot work until that key is the previous one. */
    codesOnUnknownKey: number
    /** …made before keys were named, so which key made them cannot be told. */
    codesOfUnnamedKey: number
}

type Prisma = Pick<PrismaClient, 'twoFactor' | 'recoveryCode'>

const BATCH = 500

export async function rotateSecrets(prisma: Prisma, box: AesSecretBox): Promise<RotationReport> {
    const report: RotationReport = {
        secrets: 0,
        resealed: 0,
        unreadable: [],
        codesOnPreviousKey: 0,
        codesOnUnknownKey: 0,
        codesOfUnnamedKey: 0
    }

    for (let cursor: string | undefined; ; ) {
        const rows = await prisma.twoFactor.findMany({
            select: { userId: true, secretSealed: true, user: { select: { email: true } } },
            orderBy: { userId: 'asc' },
            take: BATCH,
            ...(cursor ? { skip: 1, cursor: { userId: cursor } } : {})
        })
        for (const row of rows) {
            report.secrets++
            let resealed: string | null
            try {
                resealed = box.open(row.secretSealed).resealed
            } catch (error) {
                const reason = error instanceof SealedWithUnknownKeyError ? 'unknown-key' : 'damaged'
                report.unreadable.push({ userId: row.userId, email: row.user.email, reason })
                continue
            }
            if (!resealed) continue
            // Only if unchanged: a setup racing this keeps its own new secret.
            const { count } = await prisma.twoFactor.updateMany({
                where: { userId: row.userId, secretSealed: row.secretSealed },
                data: { secretSealed: resealed }
            })
            report.resealed += count
        }
        if (rows.length < BATCH) break
        cursor = rows[rows.length - 1].userId
    }

    const codes = await prisma.recoveryCode.findMany({
        where: { usedAt: null },
        select: { userId: true, fingerprint: true }
    })
    const accounts = { previous: new Set<string>(), unknown: new Set<string>(), unnamed: new Set<string>() }
    for (const { userId, fingerprint } of codes) {
        const key = box.keyOf(fingerprint)
        if (key === 'previous') accounts.previous.add(userId)
        else if (key === null) (fingerprint.includes('.') ? accounts.unknown : accounts.unnamed).add(userId)
    }
    report.codesOnPreviousKey = accounts.previous.size
    report.codesOnUnknownKey = accounts.unknown.size
    report.codesOfUnnamedKey = accounts.unnamed.size
    return report
}

/** What the report means for the operator, in lines to print. */
export function describeRotation(report: RotationReport, hasPrevious: boolean): string[] {
    const lines = [`✓ ${report.secrets} two-step secret(s): ${report.resealed} sealed again with the current key.`]
    if (report.unreadable.length > 0) {
        const unknown = report.unreadable.filter((a) => a.reason === 'unknown-key')
        const damaged = report.unreadable.filter((a) => a.reason === 'damaged')
        if (unknown.length > 0) {
            lines.push(
                `✗ ${unknown.length} account(s) have a secret sealed with a key this server does not have. ` +
                    'They cannot finish signing in. If you still have that key, set it as ' +
                    'AUTH_ENCRYPTION_KEY_PREVIOUS and run this again. If it is lost, turn two-step sign-in ' +
                    'off for them (they are emailed, and can turn it on again): pnpm auth:two-factor:off --unreadable --yes'
            )
        }
        if (damaged.length > 0) {
            lines.push(
                `✗ ${damaged.length} account(s) have a secret that fails its integrity check (altered in the ` +
                    'database). Turn two-step sign-in off for them: pnpm auth:two-factor:off --unreadable --yes'
            )
        }
        for (const account of report.unreadable)
            lines.push(`    ${account.email ?? account.userId} (${account.reason})`)
    }

    const needPrevious = report.codesOnPreviousKey + report.codesOfUnnamedKey
    if (hasPrevious && needPrevious > 0) {
        lines.push(
            `! Keep AUTH_ENCRYPTION_KEY_PREVIOUS: ${needPrevious} account(s) have recovery codes that may need it. ` +
                'Recovery codes cannot be sealed again (only their fingerprints are kept), so they work with the ' +
                'previous key until used, or until the account turns two-step sign-in off and on again for new ones.'
        )
    } else if (hasPrevious && report.unreadable.length === 0) {
        lines.push('✓ Nothing needs AUTH_ENCRYPTION_KEY_PREVIOUS any more: empty it, and restart the app.')
    }
    if (report.codesOnUnknownKey > 0) {
        lines.push(
            `! ${report.codesOnUnknownKey} account(s) have recovery codes made with a key this server does not ` +
                'have: they are refused until that key is set as AUTH_ENCRYPTION_KEY_PREVIOUS.'
        )
    }
    return lines
}

async function main(): Promise<void> {
    const keys = encryptionKeysFromEnv()
    const box = new AesSecretBox(keys)
    const pool = new Pool({ connectionString: process.env.DATABASE_URL })
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
    try {
        const report = await rotateSecrets(prisma, box)
        for (const line of describeRotation(report, Boolean(keys.previous))) console.log(line)
        // Someone cannot sign in: a script running this should notice.
        if (report.unreadable.length > 0) process.exitCode = 1
    } finally {
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
