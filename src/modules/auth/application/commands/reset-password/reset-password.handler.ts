import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Inject } from '@nestjs/common'
import { ResetPasswordCommand } from './reset-password.command'
import { normaliseEmail, USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import {
    checkPassword,
    CodeExpiredError,
    CodeInvalidError,
    CREDENTIAL_REPOSITORY,
    CredentialRepositoryPort,
    PasswordRejectedError,
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
    SESSION_CACHE,
    SessionCachePort,
    RATE_LIMIT,
    RateLimitPort
} from '../../ports'
import { AUTH_RATE_LIMITS, RateLimitRule } from '../../rate-limits'
import { CodeIssuer } from '../../services/code-issuer'
import { IssuedSession } from '../../services/session-issuer'
import { SignInGate } from '../../services/sign-in-gate'
import { withGuess } from '../../services/limits'

/**
 * Choose a new password with the code from "forgot password", and sign in.
 *
 * - The password is checked before the code, so a password the policy refuses
 *   does not use up the code.
 * - Every earlier session ends, this device's included: whoever else was
 *   signed in — possibly the reason for the reset — is out. Then one new
 *   session starts, for the person who just proved they read the inbox and
 *   chose the password.
 * - The address counts as confirmed: the code reached it. This is also how an
 *   account from before this module, which has no password, gets one.
 */
@CommandHandler(ResetPasswordCommand)
export class ResetPasswordHandler implements ICommandHandler<ResetPasswordCommand> {
    constructor(
        @Inject(USER_DIRECTORY) private readonly directory: UserDirectoryPort,
        @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepositoryPort,
        @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort,
        @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasherPort,
        @Inject(SESSION_CACHE) private readonly cache: SessionCachePort,
        @Inject(AUTH_MAILER) private readonly mailer: AuthMailerPort,
        @Inject(RATE_LIMIT) private readonly limiter: RateLimitPort,
        @Inject(AUTH_EVENTS) private readonly events: AuthEventsPort,
        private readonly codeIssuer: CodeIssuer,
        private readonly gate: SignInGate
    ) {}

    async execute(command: ResetPasswordCommand): Promise<IssuedSession> {
        const email = normaliseEmail(command.email)
        const guesses: [RateLimitRule, string][] = [[AUTH_RATE_LIMITS.codeAttemptsPerIp, command.client.ip]]
        const now = new Date()
        const user = await withGuess(this.limiter, guesses, async (guess) => {
            // With the address only, before the lookup: whether the password is
            // refused must not depend on whether the account exists.
            const byAddress = checkPassword(command.newPassword, { email })
            if (byAddress.length > 0) throw new PasswordRejectedError(byAddress)

            const found = await this.directory.findByEmail(email)
            if (!found) {
                guess.wrong()
                throw new CodeInvalidError()
            }
            const byUsername = checkPassword(command.newPassword, { email, username: found.username })
            if (byUsername.length > 0) throw new PasswordRejectedError(byUsername)

            const result = await this.codeIssuer.check(found.id, command.code, 'password-reset', now)
            if (result !== 'ok') {
                guess.wrong()
                throw result === 'expired' ? new CodeExpiredError() : new CodeInvalidError()
            }
            return found
        })

        // An account made with Google has no password until now: its owner is
        // told one was added, not that theirs changed.
        const hadPassword = (await this.credentials.findHash(user.id)) !== null
        await this.credentials.setHash(user.id, await this.hasher.hash(command.newPassword))
        if (!user.emailVerified) await this.directory.markEmailVerified(user.id)
        const ended = await this.sessions.revokeAllForUser(user.id, 'password-reset', now)
        await this.cache.invalidateSessions(ended)
        await this.cache.invalidateUser(user.id)
        if (hadPassword) await this.mailer.sendPasswordChanged(email)
        else await this.mailer.sendPasswordAdded(email)
        this.events.record('password_reset')
        return this.gate.pass(user.id, command.client, now)
    }
}
