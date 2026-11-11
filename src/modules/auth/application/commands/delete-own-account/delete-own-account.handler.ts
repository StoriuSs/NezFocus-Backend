import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Inject, Logger } from '@nestjs/common'
import { DeleteOwnAccountCommand } from './delete-own-account.command'
import { deletesAt, USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import {
    AccountDisabledError,
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
 * An Owner of servers with other members hands them over first (D-76). The
 * invites of the servers they own alone stop now (D-121): those servers go
 * with the account. Someone could join one, or be handed one, between the
 * check and the request (L9 review): so, once the request is saved and the
 * invites revoked, the servers are checked again, and one with others in it
 * now takes the request back with the same 409. The invites are revoked a
 * second time once no session or cached record is left that could make one.
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

    async execute({ userId, password, language }: DeleteOwnAccountCommand): Promise<Date> {
        const user = await this.directory.findById(userId)
        if (!user || user.deletedAt) throw new AccountDisabledError()

        // Every completed account has a password (D-130), and only those
        // reach this route; one without would match no password anyway.
        await this.checkPassword(userId, await this.credentials.findHash(userId), password)

        const blocking = await this.servers.serversBlockingDeletion(userId)
        if (blocking.length > 0) throw new OwnershipTransferRequiredError(blocking)

        const now = new Date()
        const requested = await this.directory.requestDeletion(userId, now)
        // Deleted meanwhile, or asked already from another tab (which ended
        // this session too, a moment ago).
        if (!requested?.deletionRequestedAt) throw new AccountDisabledError()
        const deletionDate = deletesAt(requested.deletionRequestedAt)
        await this.stopInvitesOrTakeBack(userId)

        await this.limiter.reset(AUTH_RATE_LIMITS.currentPasswordFailuresPerUser, userId)
        const ended = await this.sessions.revokeAllForUser(userId, 'deletion-requested', now)
        const email = user.email
        await afterCommit(this.logger, 'Account deletion request', [
            () => this.cache.invalidateSessions(ended),
            () => this.cache.invalidateUser(userId),
            // Again: a tab still holding the cached session could make one until now.
            () => this.servers.revokeSoloServerInvites(userId),
            async () => {
                if (!email) return
                const timeZone = (await this.directory.timeZoneOf(userId)) ?? FALLBACK_TIME_ZONE
                await this.mailer.sendDeletionScheduled(email, deletionDate, timeZone, language)
            }
        ])
        this.events.record('account_deletion_requested')
        return deletionDate
    }

    /**
     * Revoke the invites of the servers they own alone, then look again: a
     * join or a handover that slipped in since the first check takes the
     * request back (409, as before it). Revoked invites stay revoked, as
     * when the account is restored (D-121). Any failure takes it back too.
     */
    private async stopInvitesOrTakeBack(userId: string): Promise<void> {
        let blocking: Awaited<ReturnType<ServerOwnershipPort['serversBlockingDeletion']>>
        try {
            await this.servers.revokeSoloServerInvites(userId)
            blocking = await this.servers.serversBlockingDeletion(userId)
        } catch (error) {
            await this.directory.cancelDeletion(userId)
            throw error
        }
        if (blocking.length > 0) {
            await this.directory.cancelDeletion(userId)
            throw new OwnershipTransferRequiredError(blocking)
        }
    }

    /** As when changing it: wrong ones count against the user. */
    private async checkPassword(userId: string, hash: string | null, password: string): Promise<void> {
        await withGuess(this.limiter, [[AUTH_RATE_LIMITS.currentPasswordFailuresPerUser, userId]], async (guess) => {
            if (hash === null || !(await this.hasher.verify(hash, password))) {
                guess.wrong()
                throw new CurrentPasswordInvalidError()
            }
        })
    }
}
