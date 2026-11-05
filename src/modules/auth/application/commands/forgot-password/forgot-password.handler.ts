import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Inject } from '@nestjs/common'
import { ForgotPasswordCommand } from './forgot-password.command'
import { normaliseEmail, USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { CREDENTIAL_REPOSITORY, CredentialRepositoryPort } from '@/modules/auth/domain'
import { AUTH_RATE_LIMITS, RateLimitRule } from '../../rate-limits'
import { RATE_LIMIT, RateLimitPort } from '../../ports'
import { CodeIssuer } from '../../services/code-issuer'
import { enforce } from '../../services/limits'

/**
 * Email a code for choosing a new password. Answers the same whether or not
 * the address has an account; the email itself is queued, so a mail server
 * that is down cannot turn "no account" and "account" into different answers.
 */
@CommandHandler(ForgotPasswordCommand)
export class ForgotPasswordHandler implements ICommandHandler<ForgotPasswordCommand> {
    constructor(
        @Inject(USER_DIRECTORY) private readonly directory: UserDirectoryPort,
        @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepositoryPort,
        @Inject(RATE_LIMIT) private readonly limiter: RateLimitPort,
        private readonly codeIssuer: CodeIssuer
    ) {}

    async execute(command: ForgotPasswordCommand): Promise<void> {
        const email = normaliseEmail(command.email)
        const limits: [RateLimitRule, string][] = [
            [AUTH_RATE_LIMITS.codeEmailsPerIp, command.ip],
            [AUTH_RATE_LIMITS.codeEmailsPerEmailMinute, email],
            [AUTH_RATE_LIMITS.codeEmailsPerEmailHour, email]
        ]
        await enforce(this.limiter, limits)

        const user = await this.directory.findByEmail(email)
        if (!user) return
        // An account made with Google has no password: the email offers to
        // choose one, rather than to reset one it never had.
        const firstPassword = (await this.credentials.findHash(user.id)) === null
        await this.codeIssuer.issue(user.id, email, 'password-reset', new Date(), {
            firstPassword,
            name: user.displayName ?? undefined
        })
    }
}
