import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Inject } from '@nestjs/common'
import { SetPasswordCommand } from './set-password.command'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import {
    checkPassword,
    CodeExpiredError,
    CodeInvalidError,
    CREDENTIAL_REPOSITORY,
    CredentialRepositoryPort,
    PasswordAlreadySetError,
    PasswordRejectedError
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
import { SignInMethods } from '../../services/sign-in-methods'

/**
 * Set a first password, for an account made with Google. Signed in is not
 * enough on its own — a session left open on a shared computer would let
 * anyone add a permanent way in — so a code is emailed first
 * (SendPasswordSetCodeHandler), as for a reset: the password goes to whoever
 * reads the account's inbox. An account that has a password already changes
 * it instead (it knows the current one).
 */
@CommandHandler(SetPasswordCommand)
export class SetPasswordHandler implements ICommandHandler<SetPasswordCommand> {
    constructor(
        @Inject(USER_DIRECTORY) private readonly directory: UserDirectoryPort,
        @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepositoryPort,
        @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasherPort,
        @Inject(RATE_LIMIT) private readonly limiter: RateLimitPort,
        @Inject(AUTH_MAILER) private readonly mailer: AuthMailerPort,
        @Inject(AUTH_EVENTS) private readonly events: AuthEventsPort,
        private readonly methods: SignInMethods,
        private readonly codeIssuer: CodeIssuer
    ) {}

    async execute(command: SetPasswordCommand): Promise<void> {
        const guesses: [RateLimitRule, string][] = [[AUTH_RATE_LIMITS.codeAttemptsPerIp, command.ip]]
        const { user, email } = await withGuess(this.limiter, guesses, async (guess) => {
            const found = await this.directory.findById(command.userId)
            if (!found?.email || found.deletedAt) throw new CodeInvalidError()
            if ((await this.methods.of(found.id)).password) throw new PasswordAlreadySetError()

            // The rules first: a password the form must change should not use up the code.
            const broken = checkPassword(command.newPassword, { email: found.email, username: found.username })
            if (broken.length > 0) throw new PasswordRejectedError(broken)

            const result = await this.codeIssuer.check(found.id, command.code, 'password-set', new Date())
            if (result !== 'ok') {
                guess.wrong()
                throw result === 'expired' ? new CodeExpiredError() : new CodeInvalidError()
            }
            return { user: found, email: found.email }
        })

        await this.credentials.setHash(user.id, await this.hasher.hash(command.newPassword))
        await this.mailer.sendPasswordAdded(email)
        this.events.record('password_set')
    }
}
