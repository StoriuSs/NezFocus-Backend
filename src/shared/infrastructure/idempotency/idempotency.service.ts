import { Injectable, Logger, Inject } from '@nestjs/common'
import { createHash, randomUUID } from 'crypto'
import { RedisClientType } from 'redis'
import { REDIS_CLIENT } from '../cache/redis-client.provider'
import { isServiceResponse } from '@/shared/types/service-response.type'
import { REPEATED_ERROR_LOG_INTERVAL_MS, throttledLog } from '@/shared/utils/log-throttle.util'

export interface CachedResponse {
    status: 'PROCESSING' | 'COMPLETED'
    statusCode: number
    body: unknown
    timestamp: number
    /**
     * Whether `body` was a ServiceResponse built by createResponse. Its brand
     * is a non-enumerable symbol and does not survive JSON, so without this
     * the replay reaches TransformInterceptor as a plain object and is
     * wrapped a second time — the retry gets a different response shape
     * (`data.data`) from the original.
     */
    envelope?: boolean
    /**
     * Hash of the request that claimed the key, when it had a readable body.
     * A retry must send the same request; the same key with a different body
     * is a client bug, and replaying the first response would hide it.
     */
    fingerprint?: string
    /** Which request holds a PROCESSING claim (a random id per claim). */
    owner?: string
}

/**
 * A claim on a key: the exact value written by acquireLock. Only a request
 * holding it can renew or release the claim, so a request whose claim expired
 * can't remove the one a retry made after it.
 */
export type IdempotencyClaim = string

/** Deletes the key only while it still holds this claim. */
const RELEASE_IF_OWNER = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`
/** Extends the claim's lease only while the key still holds it. */
const RENEW_IF_OWNER = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) end return 0`

/**
 * Identifies one logical operation for idempotency purposes.
 *
 * The client-supplied key alone is NOT sufficient. It is an arbitrary,
 * attacker-controlled string, so keying on it alone lets one caller read
 * another caller's cached response simply by reusing their key — and lets a
 * key reused across two endpoints return the wrong endpoint's payload.
 * Binding the key to the caller and the route closes both.
 */
export interface IdempotencyScope {
    /** The raw `Idempotency-Key` header value */
    key: string
    /** Authenticated user id, or `anonymous` for public routes */
    userId: string
    /** HTTP method */
    method: string
    /** Route path */
    route: string
}

@Injectable()
export class IdempotencyService {
    private readonly logger = new Logger(IdempotencyService.name)
    // While Redis is down every idempotent request fails the same way: once a
    // minute per kind of failure.
    private readonly logAcquireFailure = throttledLog(
        (message) => this.logger.error(message),
        REPEATED_ERROR_LOG_INTERVAL_MS
    )
    private readonly logReleaseFailure = throttledLog(
        (message) => this.logger.error(message),
        REPEATED_ERROR_LOG_INTERVAL_MS
    )
    private readonly logRenewFailure = throttledLog(
        (message) => this.logger.error(message),
        REPEATED_ERROR_LOG_INTERVAL_MS
    )
    private readonly logRetrieveFailure = throttledLog(
        (message) => this.logger.error(message),
        REPEATED_ERROR_LOG_INTERVAL_MS
    )

    constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClientType) {}

    /**
     * Build the storage key for a scoped operation.
     *
     * Hashed so that a hostile or oversized header value cannot shape the
     * key space, and so the stored key length is bounded.
     */
    private generateKey(scope: IdempotencyScope): string {
        const digest = createHash('sha256')
            .update(`${scope.userId}\u0000${scope.method}\u0000${scope.route}\u0000${scope.key}`)
            .digest('hex')
        return `idempotency:${digest}`
    }

    /**
     * Claim the key for one execution with a single atomic `SET NX PX`. A
     * get-then-set would let two concurrent requests both see "no entry" and
     * both execute — the duplicate the lock exists to prevent.
     *
     * @param leaseMs how long the claim survives if its request stops renewing
     *   it (the process crashed). Deliberately short and separate from the
     *   replay TTL: the claim used to live as long as the replay (24h on
     *   account deletion), so one crash made every retry answer 409 for a day.
     *   While the request runs, the interceptor renews it (renewLock).
     * @returns the claim, or null if an entry already exists
     */
    async acquireLock(
        scope: IdempotencyScope,
        leaseMs: number,
        fingerprint?: string
    ): Promise<IdempotencyClaim | null> {
        const lock: CachedResponse = {
            status: 'PROCESSING',
            statusCode: 0,
            body: null,
            timestamp: Date.now(),
            fingerprint,
            owner: randomUUID()
        }
        const claim = JSON.stringify(lock)

        try {
            const result = await this.redis.set(this.generateKey(scope), claim, { NX: true, PX: leaseMs })
            return result === 'OK' ? claim : null
        } catch (error) {
            this.logAcquireFailure(`Failed to acquire idempotency lock, allowing the request: ${error.message}`)
            // Fail-open: allow the request to proceed if Redis is unavailable
            return claim
        }
    }

    /**
     * Extend a claim's lease while its request is still running. A request can
     * outlast the lease (a slow upload waiting its turn for image processing);
     * when the claim expired under it, a retry ran the operation a second time
     * alongside it.
     */
    async renewLock(scope: IdempotencyScope, claim: IdempotencyClaim, leaseMs: number): Promise<void> {
        try {
            await this.redis.eval(RENEW_IF_OWNER, {
                keys: [this.generateKey(scope)],
                arguments: [claim, String(leaseMs)]
            })
        } catch (error) {
            this.logRenewFailure(`Failed to renew idempotency lock: ${error.message}`)
        }
    }

    /**
     * Release a claim after the handler failed, so a retry executes fresh.
     * Deletes the entry only while it still holds this claim: never a
     * COMPLETED response, and never another request's claim.
     */
    async releaseLock(scope: IdempotencyScope, claim: IdempotencyClaim): Promise<void> {
        try {
            await this.redis.eval(RELEASE_IF_OWNER, { keys: [this.generateKey(scope)], arguments: [claim] })
        } catch (error) {
            this.logReleaseFailure(`Failed to release idempotency lock: ${error.message}`)
        }
    }

    /**
     * Store a completed response, replacing the PROCESSING claim, for `ttlMs`.
     * Throws if the write fails, so the caller can release the claim instead
     * of leaving it to its lease.
     */
    async cacheResponse(
        scope: IdempotencyScope,
        response: unknown,
        statusCode: number,
        ttlMs: number,
        fingerprint?: string
    ): Promise<void> {
        const cachedResponse: CachedResponse = {
            status: 'COMPLETED',
            statusCode,
            body: response,
            timestamp: Date.now(),
            envelope: isServiceResponse(response),
            fingerprint
        }
        await this.redis.set(this.generateKey(scope), JSON.stringify(cachedResponse), { PX: ttlMs })
    }

    /**
     * Retrieve a cached response
     */
    async getResponse(scope: IdempotencyScope): Promise<CachedResponse | undefined> {
        try {
            const raw = await this.redis.get(this.generateKey(scope))
            return raw ? (JSON.parse(raw) as CachedResponse) : undefined
        } catch (error) {
            this.logRetrieveFailure(`Failed to retrieve idempotency response: ${error.message}`)
            // Return undefined to allow fresh execution if retrieval fails
            return undefined
        }
    }
}
