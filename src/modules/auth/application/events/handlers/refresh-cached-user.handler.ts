import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { Inject, Logger } from '@nestjs/common'
import { UserProfileUpdatedEvent } from '@/modules/users'
import { SESSION_CACHE, SessionCachePort } from '../../ports'

/** The cached copy of the user behind every request must not go stale. */
@EventsHandler(UserProfileUpdatedEvent)
export class RefreshCachedUserHandler implements IEventHandler<UserProfileUpdatedEvent> {
    private readonly logger = new Logger(RefreshCachedUserHandler.name)

    constructor(@Inject(SESSION_CACHE) private readonly cache: SessionCachePort) {}

    async handle(event: UserProfileUpdatedEvent): Promise<void> {
        try {
            await this.cache.invalidateUser(event.userId)
        } catch (error) {
            this.logger.error(
                `Could not drop the cached copy of user ${event.userId}; it may be stale for up to five minutes: ${(error as Error).message}`
            )
        }
    }
}
