import { randomUUID } from 'crypto'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { createClient, RedisClientType } from 'redis'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { MetricsService } from '@/shared/infrastructure/monitoring/metrics.service'
import { PrismaUserRepository } from '@/modules/users/infrastructure/persistence/prisma-user.repository'
import { UserDirectory } from '@/modules/users/infrastructure/adapters/user-directory.adapter'
import {
    AuthSettings,
    EndSessionsOfDeletedAccountHandler,
    RefreshCommand,
    RefreshHandler
} from '@/modules/auth/application'
import { AccountDeletedEvent } from '@/modules/users'
import { AccountDisabledError, RefreshFailedError, SessionRevokedError } from '@/modules/auth/domain'
import { JoseTokenService } from '@/modules/auth/infrastructure/adapters/jose-token-service.adapter'
import { PrismaSessionRepository } from '@/modules/auth/infrastructure/persistence/prisma-session.repository'
import { PrismaCredentialRepository } from '@/modules/auth/infrastructure/persistence/prisma-credential.repository'
import { PrismaVerificationCodeRepository } from '@/modules/auth/infrastructure/persistence/prisma-verification-code.repository'
import { RedisSessionCache } from '@/modules/auth/infrastructure/adapters/redis-session-cache.adapter'
import { PrismaOAuthAccountRepository } from '@/modules/auth/infrastructure/persistence/prisma-oauth-account.repository'
import { databaseTarget, redisTarget } from './targets'

jest.mock('@/shared/infrastructure/monitoring/error-reporting', () => ({ reportError: jest.fn() }))

/**
 * Sessions, refresh-token rotation, emailed codes and the per-request session
 * check, against a real Postgres and Redis. What these rely on — a row lock,
 * an UPDATE that counts and reads in one statement, a Redis entry written
 * while the lock is held — only exists in the real services, so the handler
 * unit tests (src/modules/auth/application/commands/*.spec.ts) cannot show it.
 *
 * Requires Postgres and Redis: `pnpm test:services:up`, then `pnpm test:integration`.
 */
describe('Auth persistence and sessions (integration)', () => {
    let pool: Pool
    let prisma: PrismaClient
    let redis: RedisClientType
    let sessions: PrismaSessionRepository
    let codes: PrismaVerificationCodeRepository
    let credentials: PrismaCredentialRepository
    let oauthAccounts: PrismaOAuthAccountRepository
    let cache: RedisSessionCache
    let tokens: JoseTokenService
    let refresh: RefreshHandler

    const settings: AuthSettings = {
        accessTokenTtlSeconds: 900,
        sessionTtlDays: 30,
        codeTtlMinutes: 10,
        codeMaxAttempts: 5,
        refreshGraceMs: 10_000
    }
    const metrics = { recordCacheHit: jest.fn(), recordCacheMiss: jest.fn() } as unknown as MetricsService
    const DAY = 24 * 60 * 60 * 1000

    const newUser = (overrides: Record<string, unknown> = {}) =>
        prisma.user.create({
            data: {
                id: `itest-${randomUUID()}`,
                email: `itest-${randomUUID()}@example.test`,
                ...overrides
            }
        })

    /** A signed-in user: a session, its first refresh token, and the claims of an access token for it. */
    const signedIn = async (expiresAt = new Date(Date.now() + 30 * DAY)) => {
        const user = await newUser()
        const refreshToken = tokens.newRefreshToken()
        const session = await sessions.create({ userId: user.id, expiresAt, refreshTokenHash: refreshToken.hash })
        return { user, session, cookie: refreshToken.token, claims: { userId: user.id, sessionId: session.id } }
    }

    beforeAll(async () => {
        pool = new Pool({ connectionString: databaseTarget.url, max: 20 })
        prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
        redis = createClient({
            socket: { host: redisTarget.host, port: redisTarget.port },
            password: redisTarget.password || undefined
        })
        await redis.connect()

        const prismaService = prisma as unknown as PrismaService
        sessions = new PrismaSessionRepository(prismaService)
        codes = new PrismaVerificationCodeRepository(prismaService)
        credentials = new PrismaCredentialRepository(prismaService)
        oauthAccounts = new PrismaOAuthAccountRepository(prismaService)
        const directory = new UserDirectory(new PrismaUserRepository(prismaService))
        cache = new RedisSessionCache(redis, sessions, directory, metrics)
        tokens = new JoseTokenService(
            { secret: 'integration-only-secret-0123456789abcdef', issuer: 'itest', audience: 'itest' },
            settings
        )
        refresh = new RefreshHandler(sessions, tokens, cache, { record: jest.fn() }, settings)
    })

    afterAll(async () => {
        const ids = (await prisma.user.findMany({ where: { id: { startsWith: 'itest-' } }, select: { id: true } })).map(
            (u) => u.id
        )
        await prisma.user.deleteMany({ where: { id: { in: ids } } })
        const keys = ids.flatMap((id) => [`auth:user:${id}`])
        if (keys.length) await redis.del(keys)
        await prisma.$disconnect()
        await pool.end()
        await redis.quit()
    })

    describe('refresh-token rotation', () => {
        it('decides one rotation when several arrive together: the others wait on the row lock', async () => {
            const { cookie } = await signedIn()
            const tokenHash = tokens.hashRefreshToken(cookie)
            // Hold each transaction open, as a slow Redis write would: without
            // the lock, every one reads the token as unused meanwhile.
            const slowCommit = () => new Promise<void>((resolve) => setTimeout(resolve, 150))

            const outcomes = await Promise.all(
                Array.from({ length: 4 }, () =>
                    sessions.rotate({
                        tokenHash,
                        newTokenHash: tokens.newRefreshToken().hash,
                        now: new Date(),
                        graceMs: settings.refreshGraceMs,
                        beforeCommit: slowCommit
                    })
                )
            )

            expect(outcomes.map((o) => o.kind).sort()).toEqual(['grace', 'grace', 'grace', 'rotated'])
        })

        it('treats a replay as theft even inside the window once the replacement has been used', async () => {
            // The owner's tab refreshed twice; the thief replays the first token.
            const { session, cookie } = await signedIn()
            const next = await refresh.execute(new RefreshCommand(cookie))
            await refresh.execute(new RefreshCommand(next.refreshToken))

            await expect(refresh.execute(new RefreshCommand(cookie))).rejects.toThrow(RefreshFailedError)
            expect((await prisma.session.findUniqueOrThrow({ where: { id: session.id } })).revokedReason).toBe(
                'reuse-detected'
            )
        })
    })

    describe('emailed codes', () => {
        // By address, account or not (D-129): these addresses have none.
        const newAddress = () => `itest-code-${randomUUID()}@example.test`
        const hashOf = (code: string, email: string) => tokens.hashVerificationCode(code, email, 'sign-in')
        const inTenMinutes = () => new Date(Date.now() + 10 * 60_000)

        afterAll(async () => {
            await prisma.verificationCode.deleteMany({ where: { email: { startsWith: 'itest-code-' } } })
        })

        it('counts every one of ten wrong guesses made at once, and lets one of five simultaneous right answers through', async () => {
            const guessed = newAddress()
            await codes.replace(guessed, 'sign-in', hashOf('123456', guessed), inTenMinutes())
            const guesses = await Promise.all(
                Array.from({ length: 10 }, (_, i) =>
                    codes.check(guessed, 'sign-in', hashOf(String(900000 + i), guessed), new Date(), 5)
                )
            )
            expect(guesses.filter((g) => g === 'wrong')).toHaveLength(4)
            // Dead after: the right code is refused too.
            expect(await codes.check(guessed, 'sign-in', hashOf('123456', guessed), new Date(), 5)).toBe('expired')

            const owner = newAddress()
            await codes.replace(owner, 'sign-in', hashOf('123456', owner), inTenMinutes())
            const answers = await Promise.all(
                Array.from({ length: 5 }, async () => {
                    const right =
                        (await codes.check(owner, 'sign-in', hashOf('123456', owner), new Date(), 5)) === 'right'
                    return right && (await codes.use(owner, 'sign-in', hashOf('123456', owner), new Date()))
                })
            )
            expect(answers.filter(Boolean)).toHaveLength(1)
        })

        it('does not let an older code use up the newer one that replaced it', async () => {
            // A guess at the old code passes its check, then a new code is sent before it is used.
            const email = newAddress()
            await codes.replace(email, 'sign-in', hashOf('111111', email), inTenMinutes())
            expect(await codes.check(email, 'sign-in', hashOf('111111', email), new Date(), 5)).toBe('right')
            await codes.replace(email, 'sign-in', hashOf('222222', email), inTenMinutes())

            expect(await codes.use(email, 'sign-in', hashOf('111111', email), new Date())).toBe(false)
            expect(await codes.check(email, 'sign-in', hashOf('222222', email), new Date(), 5)).toBe('right')
            expect(await codes.use(email, 'sign-in', hashOf('222222', email), new Date())).toBe(true)
        })

        it('keeps a sign-in code and a reset code for one address apart', async () => {
            const email = newAddress()
            await codes.replace(email, 'sign-in', hashOf('123456', email), inTenMinutes())
            const resetHash = tokens.hashVerificationCode('123456', email, 'password-reset')
            await codes.replace(email, 'password-reset', resetHash, inTenMinutes())

            // The same six digits, but the reset hash is not the sign-in one.
            expect(resetHash).not.toBe(hashOf('123456', email))
            expect(await codes.check(email, 'sign-in', resetHash, new Date(), 5)).toBe('wrong')
            expect(await codes.check(email, 'password-reset', resetHash, new Date(), 5)).toBe('right')
        })
    })

    describe('the per-request session check', () => {
        it('refuses a cached session at once once it is revoked, or its account deleted', async () => {
            const revoked = await signedIn()
            await cache.resolve(revoked.claims)
            await cache.invalidateSessions(await sessions.revokeAllForUser(revoked.user.id, 'logout-all', new Date()))
            await expect(cache.resolve(revoked.claims)).rejects.toThrow(SessionRevokedError)

            const { user, claims } = await signedIn()
            await cache.resolve(claims)
            await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } })
            await prisma.credential.create({ data: { userId: user.id, passwordHash: 'argon2-hash' } })
            await oauthAccounts.link(user.id, 'google', `sub-${user.id}`)
            await new EndSessionsOfDeletedAccountHandler(sessions, credentials, oauthAccounts, cache).handle(
                new AccountDeletedEvent(user.id)
            )

            await expect(cache.resolve(claims)).rejects.toThrow(AccountDisabledError)
            expect(await prisma.session.count({ where: { userId: user.id, revokedReason: 'account-deleted' } })).toBe(1)
            // Its password and Google link go too: nothing can use them again.
            expect(await prisma.credential.count({ where: { userId: user.id } })).toBe(0)
            expect(await prisma.oAuthAccount.count({ where: { userId: user.id } })).toBe(0)
        })

        it('does not cache a session that was revoked while it was being read', async () => {
            const { user, claims } = await signedIn()
            // Pause the database read, revoke and invalidate meanwhile, then let it finish.
            let release!: () => void
            const paused = new Promise<void>((resolve) => (release = resolve))
            const original = sessions.findActive.bind(sessions)
            const findActive = jest.spyOn(sessions, 'findActive').mockImplementationOnce(async (id, now) => {
                const record = await original(id, now)
                await paused
                return record
            })

            const inFlight = cache.resolve(claims)
            await new Promise((resolve) => setTimeout(resolve, 50))
            await cache.invalidateSessions(await sessions.revokeAllForUser(user.id, 'logout', new Date()))
            release()
            await inFlight // served from its own read: it started before the revocation
            findActive.mockRestore()

            await expect(cache.resolve(claims)).rejects.toThrow(SessionRevokedError)
        })
    })
})
