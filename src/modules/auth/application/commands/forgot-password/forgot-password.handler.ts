import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Inject, Logger } from '@nestjs/common'
import { ForgotPasswordCommand } from './forgot-password.command'
import { DirectoryUser, normaliseEmail, USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { CREDENTIAL_REPOSITORY, CredentialRepositoryPort } from '@/modules/auth/domain'
import { AUTH_RATE_LIMITS, RateLimitRule } from '../../rate-limits'
import { EmailLanguage, RATE_LIMIT, RateLimitPort } from '../../ports'
import { CodeIssuer } from '../../services/code-issuer'
import { enforce } from '../../services/limits'

/**
 * Email a code for choosing a new password (REQ-AUTH-04). Answers the same
 * whether or not the address has an account, counts the same, and takes the
 * same time:
 *
 * - The limits come first and count every address, shared with sign-in codes.
 * - An address with no account still gets a stored code, one nobody is sent,
 *   so guesses at it are counted and wear it out after five exactly as for a
 *   real one (D-121). Otherwise "the fifth guess says expired" would tell
 *   which addresses have accounts.
 * - The answer waits for the same steps either way (limits, the lookup,
 *   storing the code). What only an account has (reading whether it has a
 *   password, queueing the email) happens after the answer, so timing it
 *   tells nothing (Kiểm 3 review). A queue that is down is logged, not
 *   answered (Kiểm 2 review).
 */
@CommandHandler(ForgotPasswordCommand)
export class ForgotPasswordHandler implements ICommandHandler<ForgotPasswordCommand> {
    private readonly logger = new Logger(ForgotPasswordHandler.name)

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

        const user = await this.directory.findByEmail(address)
        const code = await this.codeIssuer.store(address, 'password-reset', new Date())
        if (user) void this.email(user, address, code, language)
    }

    private async email(user: DirectoryUser, address: string, code: string, language: EmailLanguage): Promise<void> {
        try {
            // No password yet (the account was never completed, or was made
            // with Google): the email offers to choose one, rather than to
            // reset one.
            const firstPassword = (await this.credentials.findHash(user.id)) === null
            await this.codeIssuer.send(address, code, 'password-reset', {
                language,
                firstPassword,
                name: user.displayName ?? undefined
            })
        } catch (error) {
            this.logger.error(`Could not queue a password reset email: ${(error as Error)?.message}`)
        }
    }
}
