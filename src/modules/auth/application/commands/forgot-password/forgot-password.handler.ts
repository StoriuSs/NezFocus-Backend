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
 * Email a code for choosing a new password (REQ-AUTH-04). Answers the same
 * whether or not the address has an account, and counts the same:
 *
 * - The limits come first and count every address, shared with sign-in codes.
 * - An address with no account still gets a stored code, one nobody is sent,
 *   so guesses at it are counted and wear it out after five exactly as for a
 *   real one (D-121). Otherwise "the fifth guess says expired" would tell
 *   which addresses have accounts.
 * - The email is queued, so a mail server that is down cannot turn "no
 *   account" and "account" into different answers.
 */
@CommandHandler(ForgotPasswordCommand)
export class ForgotPasswordHandler implements ICommandHandler<ForgotPasswordCommand> {
    constructor(
        @Inject(USER_DIRECTORY) private readonly directory: UserDirectoryPort,
        @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepositoryPort,
        @Inject(RATE_LIMIT) private readonly limiter: RateLimitPort,
        private readonly codeIssuer: CodeIssuer
    ) {}

    async execute({ email, ip, language }: ForgotPasswordCommand): Promise<void> {
        const address = normaliseEmail(email)
        const limits: [RateLimitRule, string][] = [
            [AUTH_RATE_LIMITS.codeEmailsPerIp, ip],
            [AUTH_RATE_LIMITS.codeEmailsPerEmailMinute, address],
            [AUTH_RATE_LIMITS.codeEmailsPerEmailHour, address]
        ]
        await enforce(this.limiter, limits)

        const now = new Date()
        const user = await this.directory.findByEmail(address)
        if (!user) {
            await this.codeIssuer.issue(address, 'password-reset', now, null)
            return
        }
        // No password yet (the account was never completed, or was made with
        // Google): the email offers to choose one, rather than to reset one.
        const firstPassword = (await this.credentials.findHash(user.id)) === null
        await this.codeIssuer.issue(address, 'password-reset', now, {
            language,
            firstPassword,
            name: user.displayName ?? undefined
        })
    }
}
