import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Inject, Logger } from '@nestjs/common'
import { CompleteAccountCommand } from './complete-account.command'
import { normaliseUsername, USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import {
    AccountAlreadyCompleteError,
    AccountDisabledError,
    checkPassword,
    CREDENTIAL_REPOSITORY,
    CredentialRepositoryPort,
    PasswordRejectedError
} from '@/modules/auth/domain'
import {
    AUTH_MAILER,
    AuthMailerPort,
    PASSWORD_HASHER,
    PasswordHasherPort,
    SESSION_CACHE,
    SessionCachePort
} from '../../ports'
import { afterCommit } from '../../services/after-commit'

/**
 * The "complete your account" step (REQ-AUTH-01, D-61): display name,
 * username, password, time zone, language and the Terms, for an account just
 * made by a code or by Google. Until it is done, every other signed-in route
 * answers ACCOUNT_INCOMPLETE (AccessTokenGuard, D-128).
 *
 * The password is written in the same transaction that marks the account
 * complete (UserDirectoryPort.complete), so a completed account always has
 * one (D-130), and a submission that loses — another tab completed it first,
 * the username was taken a moment ago — changes no password. Written apart,
 * the loser of two tabs could leave its password on the completed account,
 * and a taken username could replace a password chosen through "forgot
 * password" without its owner being told (Kiểm 2 review).
 *
 * Once that transaction has committed, the account is complete: dropping the
 * cached copy and the "password changed" email are logged if they fail, not
 * answered as a failure the next try would contradict (ACCOUNT_ALREADY_COMPLETE).
 * A cached copy left behind expires within minutes (D-128).
 *
 * The username is free or not at the moment it is written: the availability
 * check the page makes while typing is only a hint (REQ-AUTH-01).
 *
 * The session making the request keeps its access token: the guard reads the
 * account on every request, so once the cached copy is dropped the same token
 * passes everywhere.
 */
@CommandHandler(CompleteAccountCommand)
export class CompleteAccountHandler implements ICommandHandler<CompleteAccountCommand> {
    private readonly logger = new Logger(CompleteAccountHandler.name)

    constructor(
        @Inject(USER_DIRECTORY) private readonly directory: UserDirectoryPort,
        @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepositoryPort,
        @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasherPort,
        @Inject(SESSION_CACHE) private readonly cache: SessionCachePort,
        @Inject(AUTH_MAILER) private readonly mailer: AuthMailerPort
    ) {}

    async execute({ userId, form }: CompleteAccountCommand): Promise<void> {
        const user = await this.directory.findById(userId)
        // Deleted between the guard and here.
        if (!user || user.deletedAt) throw new AccountDisabledError()
        if (user.completedAt) throw new AccountAlreadyCompleteError()

        const username = normaliseUsername(form.username)
        const broken = checkPassword(form.password, { email: user.email, username })
        if (broken.length > 0) throw new PasswordRejectedError(broken)

        // Usually none yet; one chosen through "forgot password" before this
        // step is replaced with only a session, so its owner hears of it.
        const hadPassword = (await this.credentials.findHash(user.id)) !== null
        // Written with the completion, in one transaction: a submission that
        // loses changes no password.
        const completed = await this.directory.complete(user.id, {
            displayName: form.displayName,
            username,
            passwordHash: await this.hasher.hash(form.password),
            timezone: form.timezone,
            language: form.language,
            completedAt: new Date()
        })
        // Another submission completed it first.
        if (!completed) throw new AccountAlreadyCompleteError()

        const email = user.email
        await afterCommit(this.logger, 'Account completion', [
            () => this.cache.invalidateUser(user.id),
            async () => {
                if (hadPassword && email) await this.mailer.sendPasswordChanged(email, form.language)
            }
        ])
    }
}
