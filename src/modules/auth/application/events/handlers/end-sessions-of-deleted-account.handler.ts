import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { Inject, Logger } from '@nestjs/common'
import { AccountDeletedEvent } from '@/modules/users'
import { AUTH_EVENTS, AuthEventsPort, SESSION_CACHE, SessionCachePort } from '../../ports'
import {
    CREDENTIAL_REPOSITORY,
    CredentialRepositoryPort,
    OAUTH_ACCOUNT_REPOSITORY,
    OAuthAccountRepositoryPort,
    SESSION_REPOSITORY,
    SessionRepositoryPort
} from '@/modules/auth/domain'
import { SessionEnds } from '../../services/session-ends'

/**
 * A deleted account's sessions end now, not when their access tokens expire,
 * and its password and its links to other providers go: the account can never
 * sign in again (a deleted row is invisible to sign-in), so they would be
 * personal data kept for nothing. Without its Google link, the same Google
 * account starts afresh next time, as the same address can with a password.
 * The users module's sweep has already erased the rest of the row (D-141);
 * this event comes after it.
 *
 * If these writes fail, the guard still refuses the account: it reads the
 * user as well as the session, and the user is marked deleted. The hourly
 * clean-up (CleanUpAuthHandler) finishes the job.
 *
 * It also counts the deletion (`account_deleted`) when the owner asked for
 * it; a sign-up left incomplete is not counted.
 */
@EventsHandler(AccountDeletedEvent)
export class EndSessionsOfDeletedAccountHandler implements IEventHandler<AccountDeletedEvent> {
    private readonly logger = new Logger(EndSessionsOfDeletedAccountHandler.name)

    constructor(
        @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort,
        @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepositoryPort,
        @Inject(OAUTH_ACCOUNT_REPOSITORY) private readonly oauthAccounts: OAuthAccountRepositoryPort,
        @Inject(SESSION_CACHE) private readonly cache: SessionCachePort,
        private readonly sessionEnds: SessionEnds,
        @Inject(AUTH_EVENTS) private readonly events: AuthEventsPort
    ) {}

    async handle(event: AccountDeletedEvent): Promise<void> {
        if (event.ownerAsked) this.events.record('account_deleted')
        try {
            await this.cache.invalidateUser(event.userId)
            const ended = await this.sessions.revokeAllForUser(event.userId, 'account-deleted', new Date())
            await this.sessionEnds.ended(ended)
            await this.credentials.delete(event.userId)
            await this.oauthAccounts.deleteForUser(event.userId)
        } catch (error) {
            this.logger.error(
                `Could not end the sessions of deleted account ${event.userId}; the guard still refuses it: ${(error as Error).message}`
            )
        }
    }
}
