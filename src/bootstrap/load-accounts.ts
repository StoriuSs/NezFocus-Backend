// Creates the accounts the load tests sign in with (docs/load-testing.md),
// already confirmed, with the password k6 is given. Straight into the
// database: registering through the API would need each account's emailed
// code. For throwaway environments only; it refuses to run in production.
//
//   LOAD_EMAIL='loadtest{n}@example.test' LOAD_PASSWORD='...' pnpm load:accounts 50
//
// The same settings k6 reads. Running it again resets the password of the
// accounts that exist and creates the missing ones.
import '../config/load-env'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../generated/prisma/client'
import { Argon2PasswordHasher } from '@/modules/auth/infrastructure/adapters/argon2-password-hasher.adapter'

/** The addresses k6 signs in as: `{n}` numbered from 1, as k6/lib/auth.js does. */
export function loadAccountEmails(pattern: string, count: number): string[] {
    if (count <= 1 || !pattern.includes('{n}')) return [pattern.replace('{n}', '').trim().toLowerCase()]
    return Array.from({ length: count }, (_, i) =>
        pattern
            .replace('{n}', String(i + 1))
            .trim()
            .toLowerCase()
    )
}

async function main(): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
        throw new Error('Refusing to create load-test accounts with NODE_ENV=production')
    }
    const pattern = process.env.LOAD_EMAIL
    const password = process.env.LOAD_PASSWORD
    const count = Number(process.argv.filter((arg) => arg !== '--')[2] ?? process.env.LOAD_USER_COUNT ?? 1)
    if (!pattern || !pattern.includes('@') || !password) {
        throw new Error("Set LOAD_EMAIL and LOAD_PASSWORD, e.g. LOAD_EMAIL='loadtest{n}@example.test'")
    }
    if (!Number.isInteger(count) || count < 1 || count > 10_000) throw new Error('The count must be 1 to 10000')

    const pool = new Pool({ connectionString: process.env.DATABASE_URL })
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
    try {
        // One hash for every account: they share the password anyway.
        const passwordHash = await new Argon2PasswordHasher().hash(password)
        const emails = loadAccountEmails(pattern, count)
        let created = 0
        for (const email of emails) {
            let userId: string
            const existing = await prisma.user.findFirst({ where: { email, deletedAt: null } })
            if (existing) {
                userId = existing.id
                if (!existing.completedAt) {
                    await prisma.user.update({ where: { id: userId }, data: { completedAt: new Date() } })
                }
            } else {
                userId = (await prisma.user.create({ data: { email, completedAt: new Date() } })).id
                created++
            }
            await prisma.credential.upsert({
                where: { userId },
                create: { userId, passwordHash },
                update: { passwordHash, passwordUpdatedAt: new Date() }
            })
        }
        console.log(`✓ ${emails.length} load-test account(s) ready (${created} new), confirmed, with LOAD_PASSWORD`)
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
