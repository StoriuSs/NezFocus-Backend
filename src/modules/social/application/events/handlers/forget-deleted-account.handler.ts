import { Inject, Logger } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { NOTIFIER, NotifierPort } from '@/modules/notifications'
import { AccountDeletedEvent } from '@/modules/users'
import { RELATIONSHIP_REPOSITORY, RelationshipRepositoryPort } from '../../../domain'

/**
 * An account's 14 days are over (D-243): its friendships, requests and
 * blocks go, either way, and the inbox items of the requests that were
 * waiting with it go too (REQ-NOTIF-03: a request gone takes its item).
 * Kept while it waited, so restoring it found them all. Nobody is told of
 * the rest: their lists already showed it as deleted (D-182) and every read
 * leaves out an account deleted for good, which also covers an event lost
 * here. A failure is logged.
 */
@EventsHandler(AccountDeletedEvent)
export class ForgetDeletedAccountHandler implements IEventHandler<AccountDeletedEvent> {
    private readonly logger = new Logger(ForgetDeletedAccountHandler.name)

    constructor(
        @Inject(RELATIONSHIP_REPOSITORY) private readonly relationships: RelationshipRepositoryPort,
        @Inject(NOTIFIER) private readonly notifier: NotifierPort
    ) {}

    async handle({ userId }: AccountDeletedEvent): Promise<void> {
        try {
            const waitedWith = await this.relationships.forgetAccount(userId)
            for (const otherId of waitedWith) await this.notifier.friendRequestClosed(userId, otherId)
        } catch (error) {
            this.logger.error(`Could not forget the relationships of deleted account ${userId}`, error)
        }
    }
}
