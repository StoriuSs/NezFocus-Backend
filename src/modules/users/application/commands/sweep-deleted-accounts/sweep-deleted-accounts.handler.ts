import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Inject, Logger } from '@nestjs/common'
import { SweepDeletedAccountsCommand } from './sweep-deleted-accounts.command'
import { UserRepositoryPort, USER_REPOSITORY } from '@/modules/users/domain'

const DAY_MS = 24 * 60 * 60 * 1000

export interface SweepDeletedAccountsResult {
    accountsErased: number
    unverifiedDeleted: number
}

/**
 * Periodic housekeeping for accounts. Safe to run concurrently or repeatedly —
 * every step is idempotent.
 *
 * 1. Erases personal data (email, names, bio, avatar key) from accounts deleted
 *    more than `retentionDays` ago. The row itself stays, so the account is
 *    still recognised and refused.
 * 2. Deletes accounts whose address was never verified, once they are older
 *    than `unverifiedRetentionDays`. Otherwise registering an address you don't
 *    own would hold it forever. Nothing references such an account: it could
 *    never sign in.
 */
@CommandHandler(SweepDeletedAccountsCommand)
export class SweepDeletedAccountsHandler implements ICommandHandler<SweepDeletedAccountsCommand> {
    private readonly logger = new Logger(SweepDeletedAccountsHandler.name)

    constructor(@Inject(USER_REPOSITORY) private readonly userRepo: UserRepositoryPort) {}

    async execute({
        now,
        retentionDays,
        unverifiedRetentionDays
    }: SweepDeletedAccountsCommand): Promise<SweepDeletedAccountsResult> {
        const erased = await this.userRepo.erasePersonalDataDeletedBefore(
            new Date(now.getTime() - retentionDays * DAY_MS)
        )
        const unverified = await this.userRepo.deleteUnverifiedCreatedBefore(
            new Date(now.getTime() - unverifiedRetentionDays * DAY_MS)
        )

        if (erased > 0) this.logger.log(`Erased personal data of ${erased} deleted account(s)`)
        if (unverified > 0) this.logger.log(`Deleted ${unverified} account(s) never verified`)
        return { accountsErased: erased, unverifiedDeleted: unverified }
    }
}
