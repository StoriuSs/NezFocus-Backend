import { Inject } from '@nestjs/common'
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { keptSince, NOTIFICATION_REPOSITORY, NotificationRepositoryPort } from '../../../domain'
import { CleanUpNotificationsCommand } from './clean-up-notifications.command'

/** How many items one statement deletes, so no lock is held for long. */
export const CLEAN_UP_BATCH = 1000

/**
 * Deletes, a batch at a time, every item made more than 90 days ago, read or
 * not (REQ-NOTIF-03). Says nothing to the inbox: an item that goes while
 * the inbox is open stays shown until it is read again (spec 06 › Edge case).
 */
@CommandHandler(CleanUpNotificationsCommand)
export class CleanUpNotificationsHandler implements ICommandHandler<CleanUpNotificationsCommand> {
    constructor(@Inject(NOTIFICATION_REPOSITORY) private readonly notifications: NotificationRepositoryPort) {}

    async execute({ now }: CleanUpNotificationsCommand): Promise<number> {
        const cutoff = keptSince(now)
        let total = 0
        for (;;) {
            const deleted = await this.notifications.removeOlderThan(cutoff, CLEAN_UP_BATCH)
            total += deleted
            if (deleted < CLEAN_UP_BATCH) return total
        }
    }
}
