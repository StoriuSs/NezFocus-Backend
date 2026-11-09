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
import {
    ACCESS_SOURCE,
    AccessSourcePort,
    PermissionCachePort,
    PermissionCheckerPort,
    ServerAccess
} from '../../application/ports'
import { CachedMember, CachedServer, decodeMember, decodeServer, encodeMember, encodeServer } from './access-codec'

/**
 * How long an entry may be served without reading the database. Every change
 * invalidates at once; this only bounds how long a lost invalidation (Redis
 * briefly unreachable, the process stopped between commit and invalidation)
 * can keep an old permission alive (D-146).
 */
const ENTRY_TTL_MS = 60_000

export const serverKey = (serverId: string) => `perm:server:${serverId}`
export const memberKey = (serverId: string, userId: string) => `perm:member:${serverId}:${userId}`

/**
 * The permission check every server action goes through (REQ-ROLE-05), and
 * the cache that makes it cheap: two entries, read in one round trip — the
 * server's roles and channels, and the member's roles and timeout (D-146).
 *
 * Only facts that exist are cached. "No such server" and "not a member" are
 * read from the database each time: caching them would let anyone fill Redis
 * with random ids, and would hide a server for a minute after it is created.
 *
 * Redis is an accelerator, not a dependency: when it cannot be reached every
 * check reads Postgres, and the failure is logged once a minute.
 */
@Injectable()
export class RedisPermissionChecker implements PermissionCheckerPort, PermissionCachePort {
    private readonly logger = new Logger(RedisPermissionChecker.name)
    private readonly logRedisFailure = throttledLog(
        (message) => this.logger.error(message),
        REPEATED_ERROR_LOG_INTERVAL_MS
    )

    constructor(
        @Inject(REDIS_CLIENT) private readonly redis: RedisClientType,
        @Inject(ACCESS_SOURCE) private readonly source: AccessSourcePort,
        private readonly metrics: MetricsService
    ) {}

    async access(serverId: string, userId: string): Promise<ServerAccess | null> {
        let cached: [VersionedRead<CachedServer>, VersionedRead<CachedMember>] | null = null
        try {
            cached = (await readVersioned(this.redis, [serverKey(serverId), memberKey(serverId, userId)])) as [
                VersionedRead<CachedServer>,
                VersionedRead<CachedMember>
            ]
        } catch (error) {
            this.logRedisFailure(`Permission cache unavailable, reading from the database: ${(error as Error).message}`)
        }

        // The member first: most refusals (not a member) end here, on the
        // smaller read.
        const member = await this.readMember(serverId, userId, cached?.[1])
        if (!member) return null
        const server = await this.readServer(serverId, cached?.[0])
        if (!server) return null
        return { server, member }
    }

    async serverChanged(serverId: string): Promise<void> {
        await this.invalidating(serverKey(serverId))
    }

    async memberChanged(serverId: string, userId: string): Promise<void> {
        await this.invalidating(memberKey(serverId, userId))
    }

    private async readMember(serverId: string, userId: string, read: VersionedRead<CachedMember> | undefined) {
        if (read?.value) {
            this.metrics.recordCacheHit('permission_member')
            return decodeMember(read.value)
        }
        this.metrics.recordCacheMiss('permission_member')
        const member = await this.source.loadMember(serverId, userId)
        if (member && read) {
            await this.quietly(() =>
                writeIfUnchanged(
                    this.redis,
                    memberKey(serverId, userId),
                    encodeMember(member),
                    ENTRY_TTL_MS,
                    read.version
                )
            )
        }
        return member
    }

    private async readServer(serverId: string, read: VersionedRead<CachedServer> | undefined) {
        if (read?.value) {
            this.metrics.recordCacheHit('permission_server')
            return decodeServer(read.value)
        }
        this.metrics.recordCacheMiss('permission_server')
        const server = await this.source.loadServer(serverId)
        if (server && read) {
            await this.quietly(() =>
                writeIfUnchanged(this.redis, serverKey(serverId), encodeServer(server), ENTRY_TTL_MS, read.version)
            )
        }
        return server
    }

    /**
     * Invalidate, trying once more on failure: a lost invalidation leaves an
     * old permission in force for up to ENTRY_TTL_MS. Never throws — the
     * change it follows has already been committed.
     */
    private async invalidating(key: string): Promise<void> {
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                await invalidate(this.redis, key)
                return
            } catch (error) {
                if (attempt === 2) {
                    this.logger.error(
                        `Could not invalidate ${key}; it lapses within a minute: ${(error as Error).message}`
                    )
                }
            }
        }
    }

    /** A failed cache write is logged, not passed on: the database answered. */
    private async quietly(operation: () => Promise<unknown>): Promise<void> {
        try {
            await operation()
        } catch (error) {
            this.logRedisFailure(`Permission cache update failed: ${(error as Error).message}`)
        }
    }
}
