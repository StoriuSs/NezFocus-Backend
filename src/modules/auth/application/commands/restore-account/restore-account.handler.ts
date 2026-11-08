import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Inject, Logger } from '@nestjs/common'
import { RestoreAccountCommand } from './restore-account.command'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { AccountDisabledError } from '@/modules/auth/domain'
import { AUTH_EVENTS, AuthEventsPort, SESSION_CACHE, SessionCachePort } from '../../ports'
import { afterCommit } from '../../services/after-commit'

/**
 * Take back a request to delete the account (REQ-AUTH-09, D-141). Signing in
 * was the proof: the dialog that offers this only shows to someone who just
 * signed in with a password, a code or Google.
 *
 * Restoring an account that is no longer waiting (another tab restored it a
 * moment ago) is not an error: the person sees the same result. One the sweep
 * deleted first is: the sweep and this cannot both win, as both are
 * conditional writes on the same row.
 *
 * The guard caches the account, so the cached copy goes at once: the next
 * request passes. Links to the servers it had alone stay revoked (D-121).
 */
@CommandHandler(RestoreAccountCommand)
export class RestoreAccountHandler implements ICommandHandler<RestoreAccountCommand> {
    private readonly logger = new Logger(RestoreAccountHandler.name)

    constructor(
        @Inject(USER_DIRECTORY) private readonly directory: UserDirectoryPort,
        @Inject(SESSION_CACHE) private readonly cache: SessionCachePort,
        @Inject(AUTH_EVENTS) private readonly events: AuthEventsPort
    ) {}

    async execute({ userId }: RestoreAccountCommand): Promise<void> {
        const restored = await this.directory.cancelDeletion(userId)
        if (!restored) {
            const user = await this.directory.findById(userId)
            if (!user || user.deletedAt) throw new AccountDisabledError()
        }

        await afterCommit(this.logger, 'Account restore', [() => this.cache.invalidateUser(userId)])
        if (restored) this.events.record('account_restored')
    }
}
