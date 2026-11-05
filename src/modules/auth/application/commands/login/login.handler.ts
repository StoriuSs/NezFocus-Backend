import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Inject } from '@nestjs/common'
import { LoginCommand } from './login.command'
import { normaliseEmail, USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import {
    CREDENTIAL_REPOSITORY,
    CredentialRepositoryPort,
    EmailNotVerifiedError,
    InvalidCredentialsError,
    RateLimitedError
} from '@/modules/auth/domain'
import {
    AUTH_EVENTS,
    AuthEventsPort,
    PASSWORD_HASHER,
    PasswordHasherPort,
    RATE_LIMIT,
    RateLimitPort
} from '../../ports'
import { AUTH_RATE_LIMITS } from '../../rate-limits'
import { IssuedSession } from '../../services/session-issuer'
import { SignInGate } from '../../services/sign-in-gate'
import { Guess, withGuess } from '../../services/limits'

/**
 * Sign in with an address and a password.
 *
 * - A wrong password, an unknown address and an account with no password are
 *   one error, and take the same time: an unknown address still runs a hash.
 * - "Not confirmed yet" is only said once the password was right. By then the
 *   caller evidently owns the account, so it gives nothing away — and the
 *   client can offer to resend the code instead of a dead end.
 * - Only failures count against the limits, and a success clears the
 *   address's count. Each attempt is counted before the password is checked
 *   (withGuess), so a burst sent all at once is limited like a slow one.
 * - The last step is the SignInGate, which every sign-in path goes through.
 */
@CommandHandler(LoginCommand)
export class LoginHandler implements ICommandHandler<LoginCommand> {
    constructor(
        @Inject(USER_DIRECTORY) private readonly directory: UserDirectoryPort,
        @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepositoryPort,
        @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasherPort,
        @Inject(RATE_LIMIT) private readonly limiter: RateLimitPort,
        @Inject(AUTH_EVENTS) private readonly events: AuthEventsPort,
        private readonly gate: SignInGate
    ) {}

    async execute(command: LoginCommand): Promise<IssuedSession> {
        const email = normaliseEmail(command.email)
        try {
            return await withGuess(
                this.limiter,
                [
                    [AUTH_RATE_LIMITS.loginFailuresPerEmail, email],
                    [AUTH_RATE_LIMITS.loginFailuresPerIp, command.client.ip]
                ],
                (guess) => this.signIn(command, email, guess)
            )
        } catch (error) {
            if (error instanceof RateLimitedError) this.events.record('login_rate_limited')
            throw error
        }
    }

    private async signIn(command: LoginCommand, email: string, guess: Guess): Promise<IssuedSession> {
        const user = await this.directory.findByEmail(email)
        const hash = user ? await this.credentials.findHash(user.id) : null
        let valid = false
        if (hash) valid = await this.hasher.verify(hash, command.password)
        else await this.hasher.verifyDummy(command.password)

        if (!user || !hash || !valid) {
            guess.wrong()
            this.events.record('login_failed')
            throw new InvalidCredentialsError()
        }

        await this.limiter.reset(AUTH_RATE_LIMITS.loginFailuresPerEmail, email)
        if (!user.emailVerified) throw new EmailNotVerifiedError()

        // Raising the hashing cost reaches existing accounts as they sign in.
        if (this.hasher.needsRehash(hash)) {
            await this.credentials.setHash(user.id, await this.hasher.hash(command.password))
        }

        this.events.record('login_succeeded')
        return this.gate.pass(user.id, command.client, new Date())
    }
}
