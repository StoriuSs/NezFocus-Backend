import { CommandBus, CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Inject } from '@nestjs/common'
import { DeleteOwnAccountCommand } from './delete-own-account.command'
import { DeleteAccountCommand, USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import {
    AccountDisabledError,
    CodeExpiredError,
    CodeInvalidError,
    ConfirmationRequiredError,
    CREDENTIAL_REPOSITORY,
    CredentialRepositoryPort,
    CurrentPasswordInvalidError
} from '@/modules/auth/domain'
import {
    AUTH_EVENTS,
    AUTH_MAILER,
    AuthEventsPort,
    AuthMailerPort,
    PASSWORD_HASHER,
    PasswordHasherPort,
    RATE_LIMIT,
    RateLimitPort
} from '../../ports'
import { AUTH_RATE_LIMITS, RateLimitRule } from '../../rate-limits'
import { CodeIssuer } from '../../services/code-issuer'
import { withGuess } from '../../services/limits'

/**
 * Delete your own account, proving it is you first: a signed-in session alone
 * is not enough, or anyone at an unlocked computer could do it.
 *
 * The password, for an account that has one; otherwise a code emailed to it.
 * Each wrong answer counts against the limits it would at sign-in. Then the users module deletes the account (and its sessions, by
 * its event), and the owner is emailed.
 */
@CommandHandler(DeleteOwnAccountCommand)
export class DeleteOwnAccountHandler implements ICommandHandler<DeleteOwnAccountCommand> {
    constructor(
        @Inject(USER_DIRECTORY) private readonly directory: UserDirectoryPort,
        @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepositoryPort,
        @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasherPort,
        @Inject(RATE_LIMIT) private readonly limiter: RateLimitPort,
        @Inject(AUTH_MAILER) private readonly mailer: AuthMailerPort,
        @Inject(AUTH_EVENTS) private readonly events: AuthEventsPort,
        private readonly codeIssuer: CodeIssuer,
        private readonly commandBus: CommandBus
    ) {}

    async execute({ userId, proof, ip }: DeleteOwnAccountCommand): Promise<void> {
        const user = await this.directory.findById(userId)
        if (!user || user.deletedAt) throw new AccountDisabledError()

        const hash = await this.credentials.findHash(userId)
        const missing = [
            ...(hash !== null && !proof.password ? ['password' as const] : []),
            ...(hash === null && !proof.code ? ['code' as const] : [])
        ]
        if (missing.length > 0) throw new ConfirmationRequiredError(missing)

        if (hash !== null) await this.checkPassword(userId, hash, proof.password!)

        if (hash === null) await this.checkCode(userId, proof.code!, ip)

        await this.commandBus.execute(new DeleteAccountCommand(userId, userId))
        await this.limiter.reset(AUTH_RATE_LIMITS.currentPasswordFailuresPerUser, userId)
        if (user.email) await this.mailer.sendAccountDeleted(user.email)
        this.events.record('account_deleted')
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

    /** As every emailed code: wrong ones count against the IP, and the code dies after five. */
    private async checkCode(userId: string, code: string, ip: string): Promise<void> {
        const guesses: [RateLimitRule, string][] = [[AUTH_RATE_LIMITS.codeAttemptsPerIp, ip]]
        await withGuess(this.limiter, guesses, async (guess) => {
            const result = await this.codeIssuer.check(userId, code, 'account-delete', new Date())
            if (result !== 'ok') {
                guess.wrong()
                throw result === 'expired' ? new CodeExpiredError() : new CodeInvalidError()
            }
        })
    }
}
