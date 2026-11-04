import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { Inject, Logger } from '@nestjs/common'
import { AccountDeletedEvent } from '../account-deleted.event'
import { BackgroundJobsPort, BACKGROUND_JOBS } from '../../ports'

/**
 * Event Handler: Cleanup Account Avatar
 *
 * Reacts to AccountDeleted events by purging the account's avatar file.
 *
 * Without this, deleting an account left the avatar in storage forever. With
 * the default local storage that directory is served unauthenticated, so a
 * deleted user's photo stayed publicly fetchable at a stable URL indefinitely
 * — a data-retention problem, not merely wasted disk.
 */
@EventsHandler(AccountDeletedEvent)
export class CleanupAccountAvatarHandler implements IEventHandler<AccountDeletedEvent> {
    private readonly logger = new Logger(CleanupAccountAvatarHandler.name)

    constructor(@Inject(BACKGROUND_JOBS) private readonly jobs: BackgroundJobsPort) {}

    async handle(event: AccountDeletedEvent): Promise<void> {
        if (!event.avatarUrl) return

        try {
            await this.jobs.deleteFileLater(event.avatarUrl)
        } catch (error) {
            this.logger.error(
                `Failed to schedule avatar deletion for deleted account ${event.userId}: ${(error as Error).message}`
            )
        }
    }
}
