import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Inject } from '@nestjs/common'
import { ChangePasswordCommand } from './change-password.command'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import {
    checkPassword,
    CREDENTIAL_REPOSITORY,
    CredentialRepositoryPort,
    CurrentPasswordInvalidError,
    PasswordRejectedError,
    SESSION_REPOSITORY,
    SessionRepositoryPort
} from '@/modules/auth/domain'
import {
    AUTH_MAILER,
    AuthMailerPort,
    PASSWORD_HASHER,
    PasswordHasherPort,
    SESSION_CACHE,
    SessionCachePort,
    RATE_LIMIT,
    RateLimitPort
} from '../../ports'
import { AUTH_RATE_LIMITS } from '../../rate-limits'
import { withGuess } from '../../services/limits'

/**
 * Change the password, knowing the current one. Ends every other session: a
 * changed password is often the response to "someone else is in my account".
 * The owner is emailed either way, in case it was not them.
 */
@CommandHandler(ChangePasswordCommand)
export class ChangePasswordHandler implements ICommandHandler<ChangePasswordCommand> {
    constructor(
        @Inject(USER_DIRECTORY) private readonly directory: UserDirectoryPort,
        @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepositoryPort,
        @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort,
        @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasherPort,
        @Inject(SESSION_CACHE) private readonly cache: SessionCachePort,
        @Inject(AUTH_MAILER) private readonly mailer: AuthMailerPort,
        @Inject(RATE_LIMIT) private readonly limiter: RateLimitPort
    ) {}

    async execute(command: ChangePasswordCommand): Promise<void> {
        const rule = AUTH_RATE_LIMITS.currentPasswordFailuresPerUser
        const user = await withGuess(this.limiter, [[rule, command.userId]], async (guess) => {
            const found = await this.directory.findById(command.userId)
            const hash = found && !found.deletedAt ? await this.credentials.findHash(found.id) : null
            if (!found || !hash || !(await this.hasher.verify(hash, command.currentPassword))) {
                guess.wrong()
                throw new CurrentPasswordInvalidError()
            }
            return found
        })

        const broken = checkPassword(command.newPassword, { email: user.email, username: user.username })
        if (broken.length > 0) throw new PasswordRejectedError(broken)

        await this.credentials.setHash(user.id, await this.hasher.hash(command.newPassword))
        const ended = await this.sessions.revokeAllForUser(user.id, 'password-changed', new Date(), command.sessionId)
        await this.cache.invalidateSessions(ended)
        await this.limiter.reset(rule, command.userId)
        if (user.email) await this.mailer.sendPasswordChanged(user.email)
    }
}
