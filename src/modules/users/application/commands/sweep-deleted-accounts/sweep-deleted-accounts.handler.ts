import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import { Inject, Logger } from '@nestjs/common'
import { SweepDeletedAccountsCommand } from './sweep-deleted-accounts.command'
import { dueForDeletion, UserRepositoryPort, USER_REPOSITORY } from '@/modules/users/domain'
import { AccountDeletedEvent } from '../../events/account-deleted.event'

export interface SweepDeletedAccountsResult {
    accountsDeleted: number
}

/**
 * Deletes the accounts whose time has come, every 15 minutes (D-141): those
 * whose owner asked 14 days ago and did not restore them (REQ-AUTH-09), and
 * those left incomplete 14 days after they were made (REQ-AUTH-01). Each is
 * marked deleted with its personal data and settings erased at once; the row
 * stays, so what points to it keeps working.
 *
 * Then, as for any deletion, AccountDeletedEvent: the auth module ends the
 * sessions and removes the password and the Google links, and the avatar file
 * is queued for removal. Safe to run concurrently or repeatedly: an account is
 * deleted once, by the statement that locks it.
 */
@CommandHandler(SweepDeletedAccountsCommand)
export class SweepDeletedAccountsHandler implements ICommandHandler<SweepDeletedAccountsCommand> {
    private readonly logger = new Logger(SweepDeletedAccountsHandler.name)

    constructor(
        @Inject(USER_REPOSITORY) private readonly userRepo: UserRepositoryPort,
        private readonly eventBus: EventBus
    ) {}

    async execute({ now }: SweepDeletedAccountsCommand): Promise<SweepDeletedAccountsResult> {
        const deleted = await this.userRepo.deleteDue(dueForDeletion(now), now)
        for (const account of deleted)
            this.eventBus.publish(new AccountDeletedEvent(account.id, account.avatarKey, account.ownerAsked))

        if (deleted.length > 0) this.logger.log(`Deleted ${deleted.length} account(s) whose time had come`)
        return { accountsDeleted: deleted.length }
    }
}
