import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { ConcurrencyLimiter } from '@/shared/utils/concurrency-limiter.util'
import { ActivityLockPort } from '../../application/ports'
import { lockActivities } from './social-locks'

/** How long a turn may hold its transaction: a few reads of the line, with room to spare. */
const ACTIVITY_TURN_MS = 10_000

/**
 * ActivityLockPort, as advisory locks held by a transaction. A turn holds a
 * pool connection for its lock while its reads ask for others (the line is
 * read through other modules' ports), so as many turns at once as the pool
 * has connections would wait on each other until the pool gives up. At most
 * a third of the pool holds one at a time, the rest queue in arrival order,
 * as the voice rooms' lock holders do (PrismaVoiceStateRepository).
 */
@Injectable()
export class PrismaActivityLock implements ActivityLockPort {
    private readonly holders: ConcurrencyLimiter

    constructor(
        private readonly prisma: PrismaService,
        config: ConfigService
    ) {
        this.holders = new ConcurrencyLimiter({
            concurrency: Math.max(1, Math.floor((config.get<number>('database.poolMax') ?? 10) / 3)),
            maxQueued: 10_000,
            maxWaitMs: 2 * ACTIVITY_TURN_MS
        })
    }

    whileHeld<T>(userIds: string[], work: () => Promise<T>): Promise<T> {
        return this.holders.run(() =>
            this.prisma.$transaction(
                async (tx) => {
                    await lockActivities(tx, userIds)
                    return work()
                },
                { timeout: ACTIVITY_TURN_MS, maxWait: ACTIVITY_TURN_MS }
            )
        )
    }
}
