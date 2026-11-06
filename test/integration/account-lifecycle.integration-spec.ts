import { randomUUID } from 'crypto'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { PrismaUserRepository } from '@/modules/users/infrastructure/persistence/prisma-user.repository'
import { databaseTarget } from './targets'

/**
 * Account writes that race in real use — double-clicked uploads, two deletion
 * requests — against a real Postgres, where the row locks and conditional
 * writes actually decide the outcome; and the sweep of sign-ups never
 * confirmed.
 *
 * Requires Postgres: `pnpm test:services:up`, then `pnpm test:integration`.
 */
describe('Account lifecycle (integration)', () => {
    let pool: Pool
    let prisma: PrismaClient
    let users: PrismaUserRepository

    const newUser = (overrides: Record<string, unknown> = {}) =>
        prisma.user.create({
            data: { id: `itest-${randomUUID()}`, email: `itest-${randomUUID()}@example.test`, ...overrides }
        })

    beforeAll(() => {
        pool = new Pool({ connectionString: databaseTarget.url, max: 20 })
        prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
        users = new PrismaUserRepository(prisma as unknown as PrismaService)
    })

    afterAll(async () => {
        await prisma.user.deleteMany({ where: { id: { startsWith: 'itest-' } } })
        await prisma.$disconnect()
        await pool.end()
    })

    describe('replaceAvatar', () => {
        it('gives every concurrent upload the key it actually replaced, so no superseded file is missed', async () => {
            const user = await newUser({ avatarUrl: 'avatars/original.webp' })
            const keys = Array.from({ length: 8 }, (_, i) => `avatars/upload-${i}.webp`)

            const results = await Promise.all(keys.map((key) => users.replaceAvatar(user.id, key)))

            // Every key but the winner's was replaced exactly once, plus the
            // original: the replaced keys form one chain.
            const final = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).avatarUrl
            const replaced = results.map((result) => result!.previousAvatarKey)
            expect(new Set(replaced).size).toBe(replaced.length)
            expect(replaced.sort()).toEqual(['avatars/original.webp', ...keys.filter((key) => key !== final)].sort())
        })
    })

    describe('softDelete', () => {
        it('lets exactly one of several concurrent deletions through', async () => {
            const user = await newUser({ avatarUrl: 'avatars/a.webp' })

            const results = await Promise.all(Array.from({ length: 5 }, () => users.softDelete(user.id, user.id)))

            const winners = results.filter(Boolean)
            expect(winners).toHaveLength(1)
            expect(winners[0]!.avatarUrl).toBe('avatars/a.webp')
        })
    })

    describe('createWithEmail', () => {
        // Signing in with a code makes the account when the address has none:
        // two such sign-ins at once must make one account, the other told so.
        it('makes one account when two are made for one address at once, whatever its case', async () => {
            const email = `itest-create-${randomUUID()}@example.test`
            const made = await Promise.all([users.createWithEmail(email), users.createWithEmail(email.toUpperCase())])

            expect(made.filter(Boolean)).toHaveLength(1)
            expect(made.find(Boolean)).toMatchObject({ email, completedAt: null })
            await prisma.user.deleteMany({ where: { email } })
        })

        it('makes a new account for the address of a deleted one', async () => {
            const deleted = await newUser({ deletedAt: new Date() })

            const made = await users.createWithEmail(deleted.email!)

            expect(made?.id).not.toBe(deleted.id)
            await prisma.user.deleteMany({ where: { id: made!.id } })
        })
    })
})
