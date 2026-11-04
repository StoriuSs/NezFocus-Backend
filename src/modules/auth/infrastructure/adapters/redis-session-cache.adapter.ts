import { Inject, Injectable, Logger } from '@nestjs/common'
import { RedisClientType } from 'redis'
import { REDIS_CLIENT } from '@/shared/infrastructure/cache/redis-client.provider'
import {
    invalidate,
    readVersioned,
    VersionedRead,
    writeIfUnchanged
} from '@/shared/infrastructure/cache/versioned-cache'
import { MetricsService } from '@/shared/infrastructure/monitoring/metrics.service'
import { REPEATED_ERROR_LOG_INTERVAL_MS, throttledLog } from '@/shared/utils/log-throttle.util'
import { DirectoryUser, USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { AccessTokenClaims, Principal, PrincipalPort, SessionCachePort } from '@/modules/auth/application/ports'
import {
    AccountDisabledError,
    SESSION_REPOSITORY,
    SessionRepositoryPort,
    SessionRevokedError,
    sessionEndReason,
    TokenInvalidError
} from '@/modules/auth/domain'
import { replacementKey, sessionKey, userKey } from './cache-keys'

/**
 * How long an entry may be served without reading the database. Invalidation
 * is immediate; this only bounds the damage if an invalidation is ever lost.
 */
const ENTRY_TTL_MS = 5 * 60_000

interface CachedSession {
    userId: string
    /** Epoch milliseconds. */
    expiresAt: number
}

type CachedUser = Omit<DirectoryUser, 'deletedAt'> & { deletedAt: string | null }

type CachedPair = [VersionedRead<CachedSession>, VersionedRead<CachedUser>]

/**
 * The check behind every authenticated request, and the cache that makes it
 * cheap: one Redis round trip for the session and the user together.
 *
 * Revocation takes effect at once. Ending a session, deleting an account or
 * changing a profile invalidates the entries through the versioned cache, so
 * a request already reading the database cannot write a stale entry back.
 *
 * Redis is an accelerator, not a dependency: if it cannot be reached, every
 * request is answered from Postgres, and the failure is logged once a minute.
 */
@Injectable()
export class RedisSessionCache implements PrincipalPort, SessionCachePort {
    private readonly logger = new Logger(RedisSessionCache.name)
    private readonly logRedisFailure = throttledLog(
        (message) => this.logger.error(message),
        REPEATED_ERROR_LOG_INTERVAL_MS
    )

    constructor(
        @Inject(REDIS_CLIENT) private readonly redis: RedisClientType,
        @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort,
        @Inject(USER_DIRECTORY) private readonly directory: UserDirectoryPort,
        private readonly metrics: MetricsService
    ) {}

    async resolve({ userId, sessionId }: AccessTokenClaims): Promise<Principal> {
        const now = Date.now()
        let cached: CachedPair | null = null
        try {
            cached = (await readVersioned(this.redis, [sessionKey(sessionId), userKey(userId)])) as CachedPair
        } catch (error) {
            this.logRedisFailure(`Session cache unavailable, reading from the database: ${(error as Error).message}`)
        }

        const session = cached?.[0].value ?? (await this.loadSession(sessionId, now, cached?.[0]))
        if (cached?.[0].value) this.metrics.recordCacheHit('auth_session')
        if (session.expiresAt <= now) throw new SessionRevokedError('expired')
        if (session.userId !== userId) throw new TokenInvalidError()

        const user = cached?.[1].value ? revive(cached[1].value) : await this.loadUser(userId, cached?.[1])
        if (cached?.[1].value) this.metrics.recordCacheHit('auth_user')
        if (user.deletedAt) throw new AccountDisabledError()

        return { user, sessionId }
    }

    async invalidateSessions(sessionIds: string[]): Promise<void> {
        await this.quietly(() => invalidate(this.redis, ...sessionIds.map(sessionKey)))
    }

    async invalidateUser(userId: string): Promise<void> {
        await this.quietly(() => invalidate(this.redis, userKey(userId)))
    }

    async rememberReplacement(oldTokenHash: string, newToken: string, ttlMs: number): Promise<void> {
        await this.redis.set(replacementKey(oldTokenHash), newToken, { PX: Math.max(1, ttlMs) })
    }

    async recallReplacement(oldTokenHash: string): Promise<string | null> {
        return this.redis.get(replacementKey(oldTokenHash))
    }

    private async loadSession(
        sessionId: string,
        now: number,
        read: VersionedRead<CachedSession> | undefined
    ): Promise<CachedSession> {
        this.metrics.recordCacheMiss('auth_session')
        const record = await this.sessions.findActive(sessionId, new Date(now))
        if (!record) {
            // Why, for the device finding out: read only on this failing path.
            const ended = await this.sessions.findEnded(sessionId, new Date(now))
            if (ended === 'account-deleted') throw new AccountDisabledError()
            throw new SessionRevokedError(ended ? sessionEndReason(ended) : undefined)
        }
        const session = { userId: record.userId, expiresAt: record.expiresAt.getTime() }
        if (read) {
            const ttl = Math.min(ENTRY_TTL_MS, session.expiresAt - now)
            await this.quietly(() => writeIfUnchanged(this.redis, sessionKey(sessionId), session, ttl, read.version))
        }
        return session
    }

    private async loadUser(userId: string, read: VersionedRead<CachedUser> | undefined): Promise<DirectoryUser> {
        this.metrics.recordCacheMiss('auth_user')
        const user = await this.directory.findById(userId)
        if (!user) throw new TokenInvalidError()
        if (read) {
            const entry: CachedUser = { ...user, deletedAt: user.deletedAt?.toISOString() ?? null }
            await this.quietly(() => writeIfUnchanged(this.redis, userKey(userId), entry, ENTRY_TTL_MS, read.version))
        }
        return user
    }

    /**
     * The database is the record; the cache only speeds it up. A failed
     * write or invalidation is logged, not passed on — an entry that should
     * have gone lives at most ENTRY_TTL_MS.
     */
    private async quietly(operation: () => Promise<unknown>): Promise<void> {
        try {
            await operation()
        } catch (error) {
            this.logRedisFailure(`Session cache update failed: ${(error as Error).message}`)
        }
    }
}

const revive = (user: CachedUser): DirectoryUser => ({
    ...user,
    deletedAt: user.deletedAt ? new Date(user.deletedAt) : null
})
