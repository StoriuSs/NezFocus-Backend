import { Inject, Injectable, Logger } from '@nestjs/common'
import { RedisClientType } from 'redis'
import { REDIS_CLIENT } from '@/shared/infrastructure/cache/redis-client.provider'
import { EventReceiptsPort } from '@/modules/voice/application'
import { MEDIA_EVENT_MEMORY_SECONDS } from '@/modules/voice/domain'

const receiptKey = (id: string) => `voice:media-event:${id}`

/**
 * Webhook ids in Redis (D-210): SET NX takes the first sight and refuses the
 * next in one step, so the same event sent twice at once is still taken
 * once. Every instance of the app shares them.
 */
@Injectable()
export class RedisEventReceipts implements EventReceiptsPort {
    private readonly logger = new Logger(RedisEventReceipts.name)

    constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClientType) {}

    async firstSight(id: string): Promise<boolean> {
        try {
            const set = await this.redis.set(receiptKey(id), '1', { NX: true, EX: MEDIA_EVENT_MEMORY_SECONDS })
            return set === 'OK'
        } catch (error) {
            this.logger.warn(`Could not note media event ${id}, taken as new: ${(error as Error).message}`)
            return true
        }
    }

    async forget(id: string): Promise<void> {
        try {
            await this.redis.del(receiptKey(id))
        } catch (error) {
            this.logger.warn(`Could not forget media event ${id}: ${(error as Error).message}`)
        }
    }
}
