import { randomUUID } from 'crypto'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { RedisClientType } from 'redis'
import { REDIS_CLIENT } from '@/shared/infrastructure/cache/redis-client.provider'
import type { PresenceReaderPort } from '@/modules/servers'
import { PRESENCES, type Presence, type SocketPresence } from '@/modules/realtime/domain'
import type { KeptPresence, PresencePort, PresenceStorePort } from '@/modules/realtime/application/ports'

/** One person's tabs: socket id → `{ idle, seenAt }`. */
const socketsKey = (userId: string) => `presence:sockets:${userId}`
/** When each person was last heard from (ms): the sweep's index (D-174). */
const SEEN = 'presence:seen'
/** What others see of each person not offline. */
const SHOWN = 'presence:shown'
/** One person's lock, and how long it lives should its holder die. */
const lockKey = (userId: string) => `presence:lock:${userId}`
const LOCK_MS = 5000
/** Lets the lock go only if it is still ours: one that expired may be someone else's by now. */
const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0`

/**
 * Presence in Redis (ARCHITECTURE 3.3, D-174), shared by every app instance:
 * a hash of tabs per person, a sorted set of when each was last heard from
 * for the sweep, and a hash of what others see of everyone not offline.
 * Writes that go together are sent as one MULTI; every change to a person
 * is made under their lock (`lock`), so a read and the write after it see
 * no other change in between.
 *
 * Also what other modules read presence through (PRESENCE, servers'
 * PRESENCE_READER): that reading never throws; nobody is online while Redis
 * cannot be reached.
 */
@Injectable()
export class RedisPresenceStore implements PresenceStorePort, PresencePort, PresenceReaderPort {
    private readonly logger = new Logger(RedisPresenceStore.name)

    constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClientType) {}

    async lock(userId: string): Promise<(() => Promise<void>) | null> {
        const token = randomUUID()
        const taken = await this.redis.set(lockKey(userId), token, { NX: true, PX: LOCK_MS })
        if (taken !== 'OK') return null
        return async () => {
            await this.redis.eval(RELEASE, { keys: [lockKey(userId)], arguments: [token] })
        }
    }

    async touch(userId: string, socketId: string, at: number, idle?: boolean): Promise<SocketPresence | undefined> {
        const old = await this.redis.hGet(socketsKey(userId), socketId)
        const was = old ? (JSON.parse(old) as SocketPresence) : undefined
        const socket: SocketPresence = { idle: idle ?? was?.idle ?? false, seenAt: at }
        await this.redis
            .multi()
            .hSet(socketsKey(userId), socketId, JSON.stringify(socket))
            .zAdd(SEEN, { score: at, value: userId })
            .exec()
        return was
    }

    async remove(userId: string, socketId: string, at: number): Promise<void> {
        await this.redis.multi().hDel(socketsKey(userId), socketId).zAdd(SEEN, { score: at, value: userId }).exec()
    }

    async read(userId: string): Promise<KeptPresence> {
        const [sockets, lastSeenAt, shown] = await Promise.all([
            this.redis.hGetAll(socketsKey(userId)),
            this.redis.zScore(SEEN, userId),
            this.redis.hGet(SHOWN, userId)
        ])
        return {
            sockets: new Map(Object.entries(sockets).map(([id, value]) => [id, JSON.parse(value) as SocketPresence])),
            lastSeenAt: lastSeenAt ?? 0,
            shown: asPresence(shown)
        }
    }

    async show(
        userId: string,
        shown: Presence,
        { deadSocketIds, forget }: { deadSocketIds: string[]; forget: boolean }
    ): Promise<void> {
        const write = this.redis.multi()
        if (forget) {
            write.del(socketsKey(userId)).zRem(SEEN, userId).hDel(SHOWN, userId)
        } else {
            if (shown === 'offline') write.hDel(SHOWN, userId)
            else write.hSet(SHOWN, userId, shown)
            if (deadSocketIds.length > 0) write.hDel(socketsKey(userId), deadSocketIds)
        }
        await write.exec()
    }

    silentSince(before: number): Promise<string[]> {
        return this.redis.zRangeByScore(SEEN, '-inf', `(${before}`)
    }

    async everyoneShown(): Promise<Map<string, Presence>> {
        try {
            const shown = await this.redis.hGetAll(SHOWN)
            return new Map(Object.entries(shown).map(([id, value]) => [id, asPresence(value)]))
        } catch (error) {
            this.logger.warn(`Presence not read, nobody shown online: ${(error as Error)?.message}`)
            return new Map()
        }
    }
}

/** A kept value as a presence; anything unexpected (or nothing) is offline. */
const asPresence = (value: string | null | undefined): Presence =>
    PRESENCES.find((known) => known === value) ?? 'offline'
