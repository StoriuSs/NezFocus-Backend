import { RedisClientType } from 'redis'

/**
 * A Redis cache entry whose invalidation cannot be undone by a slow reader.
 *
 * The problem it solves: a reader misses the cache, reads the database, and
 * writes the result back. If the record changes (a session is revoked, an
 * account deleted) between that read and that write, a plain SET puts the
 * stale record back for a full TTL, undoing the invalidation. So every entry
 * has a version counter beside it: invalidation bumps the counter, and a write
 * lands only if the counter is still the one read before the database query.
 *
 * Stored in Redis ONLY, through the shared REDIS_CLIENT — deliberately not the
 * two-layer cache. An in-memory layer would be cleared on the instance that
 * invalidated and nowhere else, so other instances would keep serving the old
 * record — for a revoked session, access — until their copy expired.
 */
export interface VersionedRead<T> {
    value: T | undefined
    /** Opaque; pass back to `writeIfUnchanged`. */
    version: string | null
}

/**
 * How long a version counter outlives its last invalidation. It only has to
 * outlast one in-flight cache miss (a database read); a day is generous.
 */
const VERSION_TTL_MS = 24 * 60 * 60 * 1000

/**
 * SET the entry only if the version counter still equals ARGV[1] — the empty
 * string standing for "no counter yet". GET and SET run as one script, so an
 * invalidation cannot slip between the check and the write.
 */
const WRITE_IF_VERSION_UNCHANGED = `
local current = redis.call('GET', KEYS[2]) or ''
if current ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
return 1
`

export const versionKeyOf = (key: string) => `${key}:v`

/** Several entries in one round trip, each with its version. */
export async function readVersioned<T>(redis: RedisClientType, keys: string[]): Promise<VersionedRead<T>[]> {
    const raw = await redis.mGet(keys.flatMap((key) => [key, versionKeyOf(key)]))
    return keys.map((_, index) => {
        const value = raw[index * 2]
        return {
            value: value ? (JSON.parse(value) as T) : undefined,
            version: raw[index * 2 + 1] ?? null
        }
    })
}

/** @returns whether the entry was written (false: invalidated meanwhile). */
export async function writeIfUnchanged<T>(
    redis: RedisClientType,
    key: string,
    value: T,
    ttlMs: number,
    version: string | null
): Promise<boolean> {
    const written = await redis.eval(WRITE_IF_VERSION_UNCHANGED, {
        keys: [key, versionKeyOf(key)],
        arguments: [version ?? '', JSON.stringify(value), String(Math.max(1, Math.floor(ttlMs)))]
    })
    return written === 1
}

/** Drop the entries, and make any write already in flight for them fail. */
export async function invalidate(redis: RedisClientType, ...keys: string[]): Promise<void> {
    if (keys.length === 0) return
    const tx = redis.multi()
    for (const key of keys) {
        tx.incr(versionKeyOf(key))
        tx.pExpire(versionKeyOf(key), VERSION_TTL_MS)
        tx.del(key)
    }
    await tx.exec()
}
