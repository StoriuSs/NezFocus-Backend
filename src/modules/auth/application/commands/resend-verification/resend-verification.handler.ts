import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Inject } from '@nestjs/common'
import { ResendVerificationCommand } from './resend-verification.command'
import { normaliseEmail, USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { AUTH_MAILER, AuthMailerPort, RATE_LIMIT, RateLimitPort } from '../../ports'
import { AUTH_RATE_LIMITS } from '../../rate-limits'
import { CodeIssuer } from '../../services/code-issuer'
import { SignInMethods } from '../../services/sign-in-methods'
import { enforce } from '../../services/limits'

/**
 * Send the sign-up email again. Answers the same whatever the address:
 *
 * - not yet confirmed: a new code;
 * - already confirmed: "you already have an account", as sign-up sends;
 * - no account: nothing.
 *
 * The limits count every request for the address, account or not.
 */
@CommandHandler(ResendVerificationCommand)
export class ResendVerificationHandler implements ICommandHandler<ResendVerificationCommand> {
    constructor(
        @Inject(USER_DIRECTORY) private readonly directory: UserDirectoryPort,
        @Inject(RATE_LIMIT) private readonly limiter: RateLimitPort,
        @Inject(AUTH_MAILER) private readonly mailer: AuthMailerPort,
        private readonly codeIssuer: CodeIssuer,
        private readonly methods: SignInMethods
    ) {}

    async execute(command: ResendVerificationCommand): Promise<void> {
        const email = normaliseEmail(command.email)
        await enforce(this.limiter, [
            [AUTH_RATE_LIMITS.codeEmailsPerIp, command.ip],
            [AUTH_RATE_LIMITS.codeEmailsPerEmailMinute, email],
            [AUTH_RATE_LIMITS.codeEmailsPerEmailHour, email]
        ])

        const user = await this.directory.findByEmail(email)
        if (!user) return
        if (!user.emailVerified) {
            await this.codeIssuer.issue(user.id, email, 'email-verify', new Date())
            return
        }
        const { password, providers } = await this.methods.of(user.id)
        await this.mailer.sendAccountExists(email, {
            password,
            providers: providers.map((id) => this.methods.displayName(id))
        })
    }
}
