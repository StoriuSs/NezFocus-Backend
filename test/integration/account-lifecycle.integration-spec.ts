import { randomUUID } from 'crypto'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { PrismaUserRepository } from '@/modules/users/infrastructure/persistence/prisma-user.repository'
import { PrismaSessionRepository } from '@/modules/auth/infrastructure/persistence/prisma-session.repository'
import { UsernameTakenError } from '@/modules/users'
import { DeletedAccount, dueForDeletion } from '@/modules/users/domain'
import { databaseTarget } from './targets'

/**
 * Account writes that race in real use — double-clicked uploads, two deletion
 * requests, a restore or a completion meeting the sweep — against a real
 * Postgres, where the row locks and conditional writes actually decide the
 * outcome.
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

    // REQ-AUTH-09, REQ-AUTH-01, D-141
    describe('deleting an account, 14 days later', () => {
        const DAY_MS = 24 * 60 * 60 * 1000
        const daysAgo = (days: number, from = new Date()) => new Date(from.getTime() - days * DAY_MS)
        const completed = { completedAt: daysAgo(100), username: () => `itest_${randomUUID().slice(0, 8)}` }
        const completedUser = (overrides: Record<string, unknown> = {}) =>
            newUser({ completedAt: completed.completedAt, username: completed.username(), ...overrides })
        const sweep = (now = new Date()) => users.deleteDue(dueForDeletion(now), now)

        it('records one of several requests at once, and none for an incomplete account', async () => {
            const user = await completedUser()
            const incomplete = await newUser()

            const results = await Promise.all(
                Array.from({ length: 5 }, () => users.requestDeletion(user.id, new Date()))
            )

            expect(results.filter(Boolean)).toHaveLength(1)
            expect(await users.requestDeletion(incomplete.id, new Date())).toBeNull()
        })

        it('deletes the accounts whose 14 days are over and leaves the rest', async () => {
            const now = new Date()
            const asked = await completedUser({
                deletionRequestedAt: daysAgo(14, now),
                avatarUrl: 'avatars/asked.webp'
            })
            const askedLately = await completedUser({ deletionRequestedAt: daysAgo(13, now) })
            const abandoned = await newUser({ createdAt: daysAgo(14, now) })
            const abandonedLately = await newUser({ createdAt: daysAgo(13, now) })
            const oldButCompleted = await completedUser({ createdAt: daysAgo(300, now) })

            const deleted = (await sweep(now)).filter((row) => row.id.startsWith('itest-'))

            expect(deleted.map((row) => row.id).sort()).toEqual([asked.id, abandoned.id].sort())
            expect(deleted.find((row) => row.id === asked.id)?.avatarKey).toBe('avatars/asked.webp')
            const rows = await prisma.user.findMany({
                where: { id: { in: [asked.id, askedLately.id, abandoned.id, abandonedLately.id, oldButCompleted.id] } }
            })
            const deletedAt = Object.fromEntries(rows.map((row) => [row.id, row.deletedAt !== null]))
            expect(deletedAt).toEqual({
                [asked.id]: true,
                [askedLately.id]: false,
                [abandoned.id]: true,
                [abandonedLately.id]: false,
                [oldButCompleted.id]: false
            })
            // Who asked is recorded as the one who deleted it; an abandoned sign-up, nobody.
            expect(rows.find((row) => row.id === asked.id)?.deletedBy).toBe(asked.id)
            expect(rows.find((row) => row.id === abandoned.id)?.deletedBy).toBeNull()
        })

        it('erases the personal data and the settings at once, which frees the address and the username', async () => {
            const user = await completedUser({
                deletionRequestedAt: daysAgo(15),
                displayName: 'Ada',
                bio: 'Hi',
                avatarUrl: 'avatars/a.webp'
            })
            await prisma.userSettings.create({
                data: { userId: user.id, timezone: 'Asia/Ho_Chi_Minh', language: 'vi' }
            })

            await sweep()

            expect(
                await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { settings: true } })
            ).toMatchObject({
                email: null,
                username: null,
                displayName: null,
                bio: null,
                avatarUrl: null,
                settings: null
            })
            const again = await users.createWithEmail(user.email!)
            expect(again?.id).not.toBe(user.id)
            await prisma.user.update({ where: { id: again!.id }, data: { username: user.username } })
            await prisma.user.deleteMany({ where: { id: again!.id } })
        })

        it('holds the address and the username while the account waits', async () => {
            const user = await completedUser({ deletionRequestedAt: daysAgo(3) })

            expect(await users.createWithEmail(user.email!)).toBeNull()
            expect(await users.findByUsername(user.username!)).not.toBeNull()
        })

        it('lets a restore or the sweep win, never both', async () => {
            for (let round = 0; round < 5; round++) {
                const user = await completedUser({ deletionRequestedAt: daysAgo(14) })

                const [restored, deleted] = await Promise.all([users.cancelDeletion(user.id), sweep()])

                const swept = deleted.some((row) => row.id === user.id)
                expect([restored, swept].filter(Boolean)).toHaveLength(1)
                const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
                expect(row.deletedAt !== null).toBe(swept)
            }
        })

        it('lets a completion or the sweep of an abandoned sign-up win, never both', async () => {
            for (let round = 0; round < 5; round++) {
                const user = await newUser({ createdAt: daysAgo(14) })

                const [made, deleted] = await Promise.all([
                    users.complete(user.id, {
                        displayName: 'Ada',
                        username: completed.username(),
                        passwordHash: 'argon2id$x',
                        timezone: 'Asia/Ho_Chi_Minh',
                        language: 'vi',
                        completedAt: new Date()
                    }),
                    sweep()
                ])

                const swept = deleted.some((row) => row.id === user.id)
                expect([made !== null, swept].filter(Boolean)).toHaveLength(1)
            }
        })

        it('deletes an account once: the next sweep leaves it, and says whether its owner asked', async () => {
            const now = new Date()
            const asked = await completedUser({ deletionRequestedAt: daysAgo(14, now) })
            const abandoned = await newUser({ createdAt: daysAgo(14, now) })
            const mine = (rows: DeletedAccount[]) =>
                rows.filter((row) => row.id === asked.id || row.id === abandoned.id)

            const first = mine(await sweep(now))
            const second = mine(await sweep(new Date(now.getTime() + 15 * 60_000)))

            expect(
                first.map(({ id, ownerAsked }) => ({ id, ownerAsked })).sort((a, b) => a.id.localeCompare(b.id))
            ).toEqual(
                [
                    { id: asked.id, ownerAsked: true },
                    { id: abandoned.id, ownerAsked: false }
                ].sort((a, b) => a.id.localeCompare(b.id))
            )
            // Deleted already: not deleted again, nor its event sent again.
            expect(second).toEqual([])
        })
    })

    // D-141, Kiểm 3: what a request to delete an account would have ended, had it crashed before.
    describe('the auth clean-up, after a deletion request that did not finish', () => {
        it('ends the sessions signed in before the request, and keeps those signed in since to restore it', async () => {
            const sessions = new PrismaSessionRepository(prisma as unknown as PrismaService)
            const DAY_MS = 24 * 60 * 60 * 1000
            const requestedAt = new Date(Date.now() - DAY_MS)
            const waiting = await newUser({ completedAt: new Date(0), deletionRequestedAt: requestedAt })
            const live = await newUser({ completedAt: new Date(0) })
            const session = (userId: string, createdAt: Date) =>
                prisma.session.create({
                    data: { userId, createdAt, expiresAt: new Date(Date.now() + 30 * DAY_MS) }
                })
            const before = await session(waiting.id, new Date(requestedAt.getTime() - DAY_MS))
            const since = await session(waiting.id, new Date(requestedAt.getTime() + 60_000))
            const other = await session(live.id, new Date(requestedAt.getTime() - DAY_MS))

            const ended = await sessions.revokeFromBeforeDeletionRequests(new Date())

            expect(ended.filter((id) => [before.id, since.id, other.id].includes(id))).toEqual([before.id])
            const rows = await prisma.session.findMany({ where: { id: { in: [before.id, since.id, other.id] } } })
            const reasonOf = Object.fromEntries(rows.map((row) => [row.id, row.revokedReason]))
            expect(reasonOf).toEqual({ [before.id]: 'deletion-requested', [since.id]: null, [other.id]: null })
        })
    })

    describe('complete', () => {
        const completion = (username: string, passwordHash = 'argon2id$new') => ({
            displayName: 'Ada',
            username,
            passwordHash,
            timezone: 'Asia/Ho_Chi_Minh',
            language: 'vi',
            completedAt: new Date()
        })
        const passwordOf = async (id: string) =>
            (await prisma.credential.findUnique({ where: { userId: id } }))?.passwordHash ?? null
        const freshName = () => `itest_${randomUUID().slice(0, 8)}`

        it('completes an account once when it is sent twice at once, with its settings row', async () => {
            const user = await newUser()
            const name = freshName()

            const results = await Promise.all([
                users.complete(user.id, completion(name)),
                users.complete(user.id, completion(name))
            ])

            expect(results.filter((result) => result !== null)).toHaveLength(1)
            const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { settings: true } })
            expect(row).toMatchObject({
                username: name,
                completedAt: expect.any(Date),
                termsAcceptedAt: expect.any(Date)
            })
            expect(row.settings).toMatchObject({ timezone: 'Asia/Ho_Chi_Minh', language: 'vi', theme: 'system' })
            expect(await users.findLanguage(user.id)).toBe('vi')
        })

        it('gives a username to one of two accounts asking for it at once', async () => {
            const [a, b] = [await newUser(), await newUser()]
            const name = freshName()

            const outcomes = await Promise.allSettled([
                users.complete(a.id, completion(name)),
                users.complete(b.id, completion(name))
            ])

            expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['fulfilled', 'rejected'])
            const refused = outcomes.find((outcome) => outcome.status === 'rejected') as PromiseRejectedResult
            expect(refused.reason).toBeInstanceOf(UsernameTakenError)
            // The loser is untouched: still incomplete, no settings.
            const loser = outcomes[0].status === 'rejected' ? a : b
            expect(
                await prisma.user.findUniqueOrThrow({ where: { id: loser.id }, include: { settings: true } })
            ).toMatchObject({ completedAt: null, username: null, settings: null })
        })

        it('leaves a deleted account alone', async () => {
            const user = await newUser({ deletedAt: new Date() })
            expect(await users.complete(user.id, completion(freshName()))).toBeNull()
            expect(await passwordOf(user.id)).toBeNull()
        })

        it('stores the password of the completion that won, and none of the one that lost', async () => {
            // Two tabs, two passwords: the account must end with the one its owner was told worked.
            const user = await newUser()
            const name = freshName()

            const results = await Promise.all([
                users.complete(user.id, completion(name, 'argon2id$tab-a')),
                users.complete(user.id, completion(name, 'argon2id$tab-b'))
            ])

            const winner = results[0] !== null ? 'argon2id$tab-a' : 'argon2id$tab-b'
            expect(await passwordOf(user.id)).toBe(winner)
        })

        it('keeps the password chosen before when the username was taken meanwhile', async () => {
            const taken = freshName()
            await newUser({ username: taken })
            const user = await newUser()
            await prisma.credential.create({ data: { userId: user.id, passwordHash: 'argon2id$from-forgot' } })

            await expect(users.complete(user.id, completion(taken))).rejects.toBeInstanceOf(UsernameTakenError)

            expect(await passwordOf(user.id)).toBe('argon2id$from-forgot')
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
