import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Inject, Logger } from '@nestjs/common'
import { SweepDeletedAccountsCommand } from './sweep-deleted-accounts.command'
import { UserRepositoryPort, USER_REPOSITORY } from '@/modules/users/domain'

const DAY_MS = 24 * 60 * 60 * 1000

export interface SweepDeletedAccountsResult {
    accountsErased: number
}

/**
 * Periodic housekeeping for accounts. Safe to run concurrently or repeatedly:
 * it erases personal data (email, names, bio, avatar key) from accounts
 * deleted more than `retentionDays` ago. The row itself stays, so the account
 * is still recognised and refused.
 *
 * There is no sweep of unconfirmed accounts: an account is only made once its
 * address is confirmed (D-59, D-133).
 */
@CommandHandler(SweepDeletedAccountsCommand)
export class SweepDeletedAccountsHandler implements ICommandHandler<SweepDeletedAccountsCommand> {
    private readonly logger = new Logger(SweepDeletedAccountsHandler.name)

    constructor(@Inject(USER_REPOSITORY) private readonly userRepo: UserRepositoryPort) {}

    async execute({ now, retentionDays }: SweepDeletedAccountsCommand): Promise<SweepDeletedAccountsResult> {
        const erased = await this.userRepo.erasePersonalDataDeletedBefore(
            new Date(now.getTime() - retentionDays * DAY_MS)
        )

        if (erased > 0) this.logger.log(`Erased personal data of ${erased} deleted account(s)`)
        return { accountsErased: erased }
    }
}
