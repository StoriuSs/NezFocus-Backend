import { Inject, Injectable } from '@nestjs/common'
import { createHash, randomBytes } from 'crypto'
import { RedisClientType } from 'redis'
import { REDIS_CLIENT } from '@/shared/infrastructure/cache/redis-client.provider'
import { TwoFactorChallengePort } from '@/modules/auth/application/ports'
import { twoFactorChallengeKey, twoFactorTriesKey } from './cache-keys'

/**
 * Sign-ins waiting for their second step, in Redis. Stored under a hash of the
 * challenge, so the keys in Redis cannot be sent back as challenges. Ended with
 * GETDEL, so a challenge completes a sign-in once.
 */
@Injectable()
export class RedisTwoFactorChallenge implements TwoFactorChallengePort {
    constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClientType) {}

    async create(userId: string, ttlSeconds: number): Promise<string> {
        const challenge = randomBytes(32).toString('base64url')
        await this.redis.set(twoFactorChallengeKey(digest(challenge)), userId, { EX: ttlSeconds })
        return challenge
    }

    find(challenge: string): Promise<string | null> {
        return this.redis.get(twoFactorChallengeKey(digest(challenge)))
    }

    async recordFailure(challenge: string, maxAttempts: number): Promise<number> {
        const id = digest(challenge)
        const ttl = await this.redis.ttl(twoFactorChallengeKey(id))
        if (ttl <= 0) return 0
        const tries = await this.redis.incr(twoFactorTriesKey(id))
        await this.redis.expire(twoFactorTriesKey(id), ttl)
        if (tries < maxAttempts) return maxAttempts - tries
        await this.redis.del([twoFactorChallengeKey(id), twoFactorTriesKey(id)])
        return 0
    }

    async take(challenge: string): Promise<string | null> {
        const id = digest(challenge)
        const userId = await this.redis.getDel(twoFactorChallengeKey(id))
        await this.redis.del(twoFactorTriesKey(id))
        return userId
    }
}

const digest = (challenge: string) => createHash('sha256').update(challenge).digest('base64url')
