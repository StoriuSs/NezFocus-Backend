import { Inject, Logger } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { AccountDeletedEvent } from '@/modules/users'
import { NOTIFICATION_REPOSITORY, NotificationRepositoryPort } from '../../../domain'

/**
 * An account's 14 days are over (D-76): its own inbox goes at once, with the
 * reasons of the moderation items written about it (D-203, like the bans of
 * D-162). Items others have where it is the actor stay, shown as a deleted
 * account (D-182). Nobody's tab is told: the account has no session left. A
 * failure is logged; the daily clean-up (CleanUpNotificationsHandler) finds
 * what is left and finishes it.
 */
@EventsHandler(AccountDeletedEvent)
export class ForgetDeletedAccountItemsHandler implements IEventHandler<AccountDeletedEvent> {
    private readonly logger = new Logger(ForgetDeletedAccountItemsHandler.name)

    constructor(@Inject(NOTIFICATION_REPOSITORY) private readonly notifications: NotificationRepositoryPort) {}

    async handle({ userId }: AccountDeletedEvent): Promise<void> {
        try {
            await this.notifications.removeAllOfDeleted(userId)
        } catch (error) {
            this.logger.error(`Could not delete the inbox of deleted account ${userId}`, error)
        }
    }
}
