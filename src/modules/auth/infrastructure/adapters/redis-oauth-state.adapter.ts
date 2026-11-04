import { Inject, Injectable } from '@nestjs/common'
import { RedisClientType } from 'redis'
import { REDIS_CLIENT } from '@/shared/infrastructure/cache/redis-client.provider'
import { OAuthAttempt, OAuthStatePort } from '@/modules/auth/application/ports'
import { oauthAttemptKey } from './cache-keys'

/**
 * Sign-in attempts at another provider, in Redis between leaving and coming
 * back. Taken with GETDEL, so an attempt can be finished once: a replayed
 * return finds nothing, even if two arrive together.
 *
 * Unlike the session cache, this has no database to fall back to: with Redis
 * down, signing in with a provider fails (and says so) while passwords work.
 */
@Injectable()
export class RedisOAuthState implements OAuthStatePort {
    constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClientType) {}

    async save(attempt: OAuthAttempt, ttlSeconds: number): Promise<void> {
        await this.redis.set(oauthAttemptKey(attempt.checks.state), JSON.stringify(attempt), { EX: ttlSeconds })
    }

    async take(state: string): Promise<OAuthAttempt | null> {
        const stored = await this.redis.getDel(oauthAttemptKey(state))
        return stored ? (JSON.parse(stored) as OAuthAttempt) : null
    }
}
