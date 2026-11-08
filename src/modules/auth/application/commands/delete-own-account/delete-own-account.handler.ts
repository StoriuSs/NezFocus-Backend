import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Inject, Logger } from '@nestjs/common'
import { DeleteOwnAccountCommand } from './delete-own-account.command'
import { deletesAt, USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import {
    AccountDisabledError,
    ConfirmationRequiredError,
    CREDENTIAL_REPOSITORY,
    CredentialRepositoryPort,
    CurrentPasswordInvalidError,
    OwnershipTransferRequiredError,
    SESSION_REPOSITORY,
    SessionRepositoryPort
} from '@/modules/auth/domain'
import {
    AUTH_EVENTS,
    AUTH_MAILER,
    AuthEventsPort,
    AuthMailerPort,
    PASSWORD_HASHER,
    PasswordHasherPort,
    RATE_LIMIT,
    RateLimitPort,
    SERVER_OWNERSHIP,
    ServerOwnershipPort,
    SESSION_CACHE,
    SessionCachePort
} from '../../ports'
import { AUTH_RATE_LIMITS } from '../../rate-limits'
import { withGuess } from '../../services/limits'
import { afterCommit } from '../../services/after-commit'

/** For an account with no settings row, which a completed one always has. */
const FALLBACK_TIME_ZONE = 'UTC'

/**
 * Ask to delete your own account (REQ-AUTH-09, D-141), proving it is you
 * first with the password: a signed-in session alone is not enough, or anyone
 * at an unlocked computer could do it. Wrong passwords count as when changing
 * it.
 *
 * Nothing is deleted yet. The account waits 14 days, still live: every
 * session ends now (reason `deletion-requested`, so other devices can say
 * when it goes), and signing in again within the 14 days offers to restore
 * it. The users module's sweep deletes it once they are over. The owner is
 * emailed the date, in the account's time zone.
 *
 * An Owner of servers with other members hands them over first (D-76).
 *
 * @returns when the account is deleted
 */
@CommandHandler(DeleteOwnAccountCommand)
export class DeleteOwnAccountHandler implements ICommandHandler<DeleteOwnAccountCommand> {
    private readonly logger = new Logger(DeleteOwnAccountHandler.name)

    constructor(
        @Inject(USER_DIRECTORY) private readonly directory: UserDirectoryPort,
        @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepositoryPort,
        @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort,
        @Inject(SESSION_CACHE) private readonly cache: SessionCachePort,
        @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasherPort,
        @Inject(RATE_LIMIT) private readonly limiter: RateLimitPort,
        @Inject(SERVER_OWNERSHIP) private readonly servers: ServerOwnershipPort,
        @Inject(AUTH_MAILER) private readonly mailer: AuthMailerPort,
        @Inject(AUTH_EVENTS) private readonly events: AuthEventsPort
    ) {}

    async execute({ userId, proof, language }: DeleteOwnAccountCommand): Promise<Date> {
        const user = await this.directory.findById(userId)
        if (!user || user.deletedAt) throw new AccountDisabledError()

        const hash = await this.credentials.findHash(userId)
        if (hash === null || !proof.password) throw new ConfirmationRequiredError(['password'])
        await this.checkPassword(userId, hash, proof.password)

        const blocking = await this.servers.serversBlockingDeletion(userId)
        if (blocking.length > 0) throw new OwnershipTransferRequiredError(blocking)

        const now = new Date()
        const requested = await this.directory.requestDeletion(userId, now)
        // Deleted meanwhile, or asked already from another tab (which ended
        // this session too, a moment ago).
        if (!requested?.deletionRequestedAt) throw new AccountDisabledError()
        const deletionDate = deletesAt(requested.deletionRequestedAt)

        await this.limiter.reset(AUTH_RATE_LIMITS.currentPasswordFailuresPerUser, userId)
        const ended = await this.sessions.revokeAllForUser(userId, 'deletion-requested', now)
        const email = user.email
        await afterCommit(this.logger, 'Account deletion request', [
            () => this.cache.invalidateSessions(ended),
            () => this.cache.invalidateUser(userId),
            async () => {
                if (!email) return
                const timeZone = (await this.directory.timeZoneOf(userId)) ?? FALLBACK_TIME_ZONE
                await this.mailer.sendDeletionScheduled(email, deletionDate, timeZone, language)
            }
        ])
        this.events.record('account_deleted')
        return deletionDate
    }

    /** As when changing it: wrong ones count against the user. */
    private async checkPassword(userId: string, hash: string, password: string): Promise<void> {
        await withGuess(this.limiter, [[AUTH_RATE_LIMITS.currentPasswordFailuresPerUser, userId]], async (guess) => {
            if (!(await this.hasher.verify(hash, password))) {
                guess.wrong()
                throw new CurrentPasswordInvalidError()
            }
        })
    }
}
