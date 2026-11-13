import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Inject, Logger } from '@nestjs/common'
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
import { afterCommit } from '../../services/after-commit'
import { SessionEnds } from '../../services/session-ends'

/**
 * Choose a new password with the code from "forgot password", and sign in
 * (REQ-AUTH-04, D-62).
 *
 * The order of the checks is what keeps this from telling anyone which
 * addresses have accounts:
 *
 * 1. The password rules that need only the address. Their answer is the same
 *    with or without an account, and a refused password does not use a try.
 * 2. The code. Every address that asked has one (ForgotPasswordHandler), so a
 *    wrong guess is counted and answered the same everywhere: wrong codes per
 *    IP, per address (D-134), and five per code.
 * 3. Only with the right code — the person reads the inbox — the account, and
 *    "the password is your username" (D-66). Checked before the code was
 *    known right, that answer would say "an account with this username has
 *    this address" to anyone guessing.
 * 4. Then the code is used up: a password refused at 3 keeps it.
 *
 * Every earlier session ends, this device's included: whoever else was signed
 * in — possibly the reason for the reset — is out. Then one new session
 * starts, for the person who just proved they read the inbox.
 */
@CommandHandler(ResetPasswordCommand)
export class ResetPasswordHandler implements ICommandHandler<ResetPasswordCommand> {
    private readonly logger = new Logger(ResetPasswordHandler.name)

    constructor(
        @Inject(USER_DIRECTORY) private readonly directory: UserDirectoryPort,
        @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepositoryPort,
        @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort,
        @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasherPort,
        @Inject(SESSION_CACHE) private readonly cache: SessionCachePort,
        private readonly sessionEnds: SessionEnds,
        @Inject(AUTH_MAILER) private readonly mailer: AuthMailerPort,
        @Inject(RATE_LIMIT) private readonly limiter: RateLimitPort,
        @Inject(AUTH_EVENTS) private readonly events: AuthEventsPort,
        private readonly codeIssuer: CodeIssuer,
        private readonly gate: SignInGate
    ) {}

    async execute(command: ResetPasswordCommand): Promise<IssuedSession> {
        const address = normaliseEmail(command.email)
        const guesses: [RateLimitRule, string][] = [
            [AUTH_RATE_LIMITS.codeAttemptsPerIp, command.client.ip],
            [AUTH_RATE_LIMITS.codeFailuresPerEmail, address]
        ]
        const now = new Date()
        const user = await withGuess(this.limiter, guesses, async (guess) => {
            const byAddress = checkPassword(command.newPassword, { email: address })
            if (byAddress.length > 0) throw new PasswordRejectedError(byAddress)

            const result = await this.codeIssuer.check(address, command.code, 'password-reset', now)
            const found = result === 'right' ? await this.directory.findByEmail(address) : null
            // `right` with no account: the unsent code of an address without
            // one was guessed. Wrong all the same.
            if (!found) {
                guess.wrong()
                throw result === 'expired' ? new CodeExpiredError() : new CodeInvalidError()
            }

            const byUsername = checkPassword(command.newPassword, { email: address, username: found.username })
            if (byUsername.length > 0) throw new PasswordRejectedError(byUsername)

            if (!(await this.codeIssuer.use(address, command.code, 'password-reset', now))) {
                throw new CodeInvalidError()
            }
            return found
        })

        // No password until now (never completed, or made with Google): its
        // owner is told one was added, not that theirs changed.
        const hadPassword = (await this.credentials.findHash(user.id)) !== null
        await this.credentials.setHash(user.id, await this.hasher.hash(command.newPassword))
        const ended = await this.sessions.revokeAllForUser(user.id, 'password-reset', now)
        // The password has changed and the sessions are revoked: what is left
        // is logged if it fails, and the reset still signs in. A cached
        // session left behind expires on its own, as it would have anyway.
        await afterCommit(this.logger, 'Password reset', [
            () => this.sessionEnds.ended(ended),
            () => this.cache.invalidateUser(user.id),
            () =>
                hadPassword
                    ? this.mailer.sendPasswordChanged(address, command.language)
                    : this.mailer.sendPasswordAdded(address, command.language)
        ])
        this.events.record('password_reset')
        return this.gate.pass(user.id, command.client, now)
    }
}
