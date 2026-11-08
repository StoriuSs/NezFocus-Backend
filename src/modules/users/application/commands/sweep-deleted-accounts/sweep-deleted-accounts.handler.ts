import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import { Inject, Logger } from '@nestjs/common'
import { SweepDeletedAccountsCommand } from './sweep-deleted-accounts.command'
import { dueForDeletion, UserRepositoryPort, USER_REPOSITORY } from '@/modules/users/domain'
import { BackgroundJobsPort, BACKGROUND_JOBS } from '../../ports'
import { AccountDeletedEvent } from '../../events/account-deleted.event'

/** Avatar files queued a run; more wait for the next sweep. */
const AVATARS_PER_RUN = 200

export interface SweepDeletedAccountsResult {
    accountsDeleted: number
    avatarFilesQueued: number
}

/**
 * Deletes the accounts whose time has come, every 15 minutes (D-141): those
 * whose owner asked 14 days ago and did not restore them (REQ-AUTH-09), and
 * those left incomplete 14 days after they were made (REQ-AUTH-01). Each is
 * marked deleted with its personal data and settings erased at once; the row
 * stays, so what points to it keeps working.
 *
 * Then, as for any deletion, AccountDeletedEvent: the auth module ends the
 * sessions and removes the password and the Google links.
 *
 * Last, the avatar files of deleted accounts are queued for removal, and only
 * then are their keys forgotten. The key is all that leads to a file, so it is
 * kept in the row until the job is safely in the queue: if the process dies in
 * between, the next sweep finds the key and queues the file again (the job's
 * id makes that one job). An in-memory event would lose it.
 *
 * Safe to run concurrently or repeatedly: an account is deleted once, by the
 * statement that locks it, and a file deletion is one job whoever queues it.
 */
@CommandHandler(SweepDeletedAccountsCommand)
export class SweepDeletedAccountsHandler implements ICommandHandler<SweepDeletedAccountsCommand> {
    private readonly logger = new Logger(SweepDeletedAccountsHandler.name)

    constructor(
        @Inject(USER_REPOSITORY) private readonly userRepo: UserRepositoryPort,
        @Inject(BACKGROUND_JOBS) private readonly jobs: BackgroundJobsPort,
        private readonly eventBus: EventBus
    ) {}

    async execute({ now }: SweepDeletedAccountsCommand): Promise<SweepDeletedAccountsResult> {
        const deleted = await this.userRepo.deleteDue(dueForDeletion(now), now)
        for (const account of deleted) this.eventBus.publish(new AccountDeletedEvent(account.id, account.ownerAsked))
        if (deleted.length > 0) this.logger.log(`Deleted ${deleted.length} account(s) whose time had come`)

        const avatarFilesQueued = await this.queueAvatarFiles()
        return { accountsDeleted: deleted.length, avatarFilesQueued }
    }

    private async queueAvatarFiles(): Promise<number> {
        const leftovers = await this.userRepo.findAvatarsOfDeleted(AVATARS_PER_RUN)
        if (leftovers.length === 0) return 0

        // Queued first, forgotten after: a failure here leaves the keys for the next run.
        await this.jobs.deleteFilesLater(leftovers.map((leftover) => leftover.avatarKey))
        await this.userRepo.forgetAvatarsOfDeleted(leftovers.map((leftover) => leftover.id))
        return leftovers.length
    }
}
