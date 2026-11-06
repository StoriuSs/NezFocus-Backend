import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Inject } from '@nestjs/common'
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

/**
 * The "complete your account" step (REQ-AUTH-01, D-61): display name,
 * username, password, time zone, language and the Terms, for an account just
 * made by a code or by Google. Until it is done, every other signed-in route
 * answers ACCOUNT_INCOMPLETE (AccessTokenGuard, D-128).
 *
 * The password is stored before the account is marked complete, so a
 * completed account always has one (D-130): if completing then fails — the
 * username was taken a moment ago — the account is still incomplete, and the
 * next try replaces the password. The other order could leave a completed
 * account with no password. The cost: two submissions with different
 * passwords at the same moment (two tabs) can leave the password of the one
 * answered ACCOUNT_ALREADY_COMPLETE. Both came from the owner's own sessions,
 * and "forgot password" sets it straight.
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
        await this.credentials.setHash(user.id, await this.hasher.hash(form.password))
        const completed = await this.directory.complete(user.id, {
            displayName: form.displayName,
            username,
            timezone: form.timezone,
            language: form.language,
            completedAt: new Date()
        })
        // Another submission completed it first.
        if (!completed) throw new AccountAlreadyCompleteError()

        await this.cache.invalidateUser(user.id)
        if (hadPassword && user.email) await this.mailer.sendPasswordChanged(user.email, form.language)
    }
}
