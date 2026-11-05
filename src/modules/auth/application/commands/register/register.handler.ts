import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Inject } from '@nestjs/common'
import { RegisterCommand } from './register.command'
import { normaliseEmail, USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import {
    checkPassword,
    CREDENTIAL_REPOSITORY,
    CredentialRepositoryPort,
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
import { SignInMethods } from '../../services/sign-in-methods'
import { enforce } from '../../services/limits'

/**
 * Create an account and email a code to confirm the address.
 *
 * Answers the same whatever the address: new, taken, or registered and never
 * confirmed. Otherwise registration would tell anyone which addresses have
 * accounts. So:
 *
 * - The password is checked and hashed first, every time: a taken address
 *   skipping the hash would answer measurably faster.
 * - A confirmed address gets an email instead of a code: "you already have an
 *   account, sign in or reset your password". Only the inbox's owner learns
 *   the account exists, and they are not left waiting for a code. It counts
 *   against the same per-address email limits as a code.
 * - An address registered but never confirmed gets the new password and a
 *   fresh code. Whoever can read the mail is the owner; if that was not the
 *   person who registered first, their password is simply replaced.
 */
@CommandHandler(RegisterCommand)
export class RegisterHandler implements ICommandHandler<RegisterCommand> {
    constructor(
        @Inject(USER_DIRECTORY) private readonly directory: UserDirectoryPort,
        @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepositoryPort,
        @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasherPort,
        @Inject(RATE_LIMIT) private readonly limiter: RateLimitPort,
        @Inject(AUTH_EVENTS) private readonly events: AuthEventsPort,
        @Inject(AUTH_MAILER) private readonly mailer: AuthMailerPort,
        private readonly codeIssuer: CodeIssuer,
        private readonly methods: SignInMethods
    ) {}

    async execute(command: RegisterCommand): Promise<void> {
        const email = normaliseEmail(command.email)

        const broken = checkPassword(command.password, { email })
        if (broken.length > 0) throw new PasswordRejectedError(broken)
        const limits: [RateLimitRule, string][] = [
            [AUTH_RATE_LIMITS.registrationsPerIp, command.ip],
            [AUTH_RATE_LIMITS.registrationsPerEmailMinute, email],
            [AUTH_RATE_LIMITS.codeEmailsPerEmailHour, email]
        ]
        // After the password rules: a password the form must change should not
        // use up one of the address's emails.
        await enforce(this.limiter, limits)

        const hash = await this.hasher.hash(command.password)
        const existing = await this.directory.findByEmail(email)
        if (existing?.emailVerified) {
            await this.mailer.sendAccountExists(email, await this.describe(existing.id))
            return
        }

        const user = existing ?? (await this.directory.createUnverified(email))
        // Null: a concurrent registration for the same address won the race.
        if (!user) return

        await this.credentials.setHash(user.id, hash)
        await this.codeIssuer.issue(user.id, email, 'email-verify', new Date())
        if (!existing) this.events.record('registration')
    }

    /** How the account signs in, for the email: providers by the names people know. */
    private async describe(userId: string) {
        const { password, providers } = await this.methods.of(userId)
        return { password, providers: providers.map((id) => this.methods.displayName(id)) }
    }
}
