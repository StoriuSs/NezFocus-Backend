import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { Inject, Logger } from '@nestjs/common'
import { AccountDeletedEvent } from '@/modules/users'
import { SESSION_CACHE, SessionCachePort } from '../../ports'
import {
    CREDENTIAL_REPOSITORY,
    CredentialRepositoryPort,
    OAUTH_ACCOUNT_REPOSITORY,
    OAuthAccountRepositoryPort,
    SESSION_REPOSITORY,
    SessionRepositoryPort,
    TWO_FACTOR_REPOSITORY,
    TwoFactorRepositoryPort
} from '@/modules/auth/domain'

/**
 * A deleted account's sessions end now, not when their access tokens expire,
 * and its password, its two-step secret and recovery codes, and its links
 * to other providers go: the account can never
 * sign in again (a deleted row is invisible to sign-in), so they would be
 * personal data kept for nothing. Without its Google link, the same Google
 * account starts afresh next time, as the same address can with a password. The users module's sweep erases the rest of the row later.
 *
 * If these writes fail, the guard still refuses the account: it reads the
 * user as well as the session, and the user is marked deleted. The hourly
 * clean-up (CleanUpAuthHandler) finishes the job.
 */
@EventsHandler(AccountDeletedEvent)
export class EndSessionsOfDeletedAccountHandler implements IEventHandler<AccountDeletedEvent> {
    private readonly logger = new Logger(EndSessionsOfDeletedAccountHandler.name)

    constructor(
        @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort,
        @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepositoryPort,
        @Inject(OAUTH_ACCOUNT_REPOSITORY) private readonly oauthAccounts: OAuthAccountRepositoryPort,
        @Inject(TWO_FACTOR_REPOSITORY) private readonly twoFactors: TwoFactorRepositoryPort,
        @Inject(SESSION_CACHE) private readonly cache: SessionCachePort
    ) {}

    async handle(event: AccountDeletedEvent): Promise<void> {
        try {
            await this.cache.invalidateUser(event.userId)
            const ended = await this.sessions.revokeAllForUser(event.userId, 'account-deleted', new Date())
            await this.cache.invalidateSessions(ended)
            await this.credentials.delete(event.userId)
            await this.oauthAccounts.deleteForUser(event.userId)
            await this.twoFactors.remove(event.userId)
        } catch (error) {
            this.logger.error(
                `Could not end the sessions of deleted account ${event.userId}; the guard still refuses it: ${(error as Error).message}`
            )
        }
    }
}
