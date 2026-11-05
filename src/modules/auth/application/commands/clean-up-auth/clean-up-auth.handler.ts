import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Inject, Logger } from '@nestjs/common'
import { CleanUpAuthCommand } from './clean-up-auth.command'
import { SESSION_CACHE, SessionCachePort } from '../../ports'
import {
    CREDENTIAL_REPOSITORY,
    CredentialRepositoryPort,
    OAUTH_ACCOUNT_REPOSITORY,
    OAuthAccountRepositoryPort,
    SESSION_REPOSITORY,
    SessionRepositoryPort,
    VERIFICATION_CODE_REPOSITORY,
    VerificationCodeRepositoryPort
} from '@/modules/auth/domain'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Remove what can no longer be used. Sessions are kept a week after they end,
 * with their used refresh tokens: a stolen token presented in that week is
 * still recognised as reuse. Codes are kept a day after they stop working.
 *
 * Also finishes what an account deletion's event handler would have done, if
 * that event was lost (a crash between saving the deletion and handling it):
 * the account's sessions end, and its password and provider links go. They were refused all along — the guard and refresh read the user — so this is tidying, not a fix.
 */
@CommandHandler(CleanUpAuthCommand)
export class CleanUpAuthHandler implements ICommandHandler<CleanUpAuthCommand> {
    private readonly logger = new Logger(CleanUpAuthHandler.name)

    constructor(
        @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort,
        @Inject(VERIFICATION_CODE_REPOSITORY) private readonly codes: VerificationCodeRepositoryPort,
        @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepositoryPort,
        @Inject(OAUTH_ACCOUNT_REPOSITORY) private readonly oauthAccounts: OAuthAccountRepositoryPort,
        @Inject(SESSION_CACHE) private readonly cache: SessionCachePort
    ) {}

    async execute({ now }: CleanUpAuthCommand): Promise<{ sessions: number; codes: number; orphans: number }> {
        const orphaned = await this.sessions.revokeForDeletedAccounts(now)
        await this.cache.invalidateSessions(orphaned)
        const passwords = await this.credentials.deleteForDeletedAccounts()
        const links = await this.oauthAccounts.deleteForDeletedAccounts()
        if (orphaned.length > 0 || passwords > 0 || links > 0) {
            this.logger.warn(
                `Ended ${orphaned.length} session(s), removed ${passwords} password(s) and ${links} provider link(s) of deleted accounts: an account deletion's event was not handled`
            )
        }

        const sessions = await this.sessions.deleteEnded(new Date(now.getTime() - 7 * DAY_MS))
        const codes = await this.codes.deleteStale(new Date(now.getTime() - DAY_MS))
        if (sessions > 0 || codes > 0) this.logger.log(`Removed ${sessions} ended session(s) and ${codes} old code(s)`)
        return { sessions, codes, orphans: orphaned.length + passwords + links }
    }
}
