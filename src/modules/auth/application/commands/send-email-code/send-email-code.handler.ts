import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Inject } from '@nestjs/common'
import { SendEmailCodeCommand } from './send-email-code.command'
import { normaliseEmail, USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { RATE_LIMIT, RateLimitPort } from '../../ports'
import { AUTH_RATE_LIMITS } from '../../rate-limits'
import { CodeIssuer } from '../../services/code-issuer'
import { enforce } from '../../services/limits'

/**
 * Email a sign-in code to an address (REQ-AUTH-01, REQ-AUTH-02). One flow for
 * "create an account" and "sign in with a code": the right code signs in to
 * the address's account, or makes one if it has none (D-59, D-60).
 *
 * Answers the same whatever the address, and does the same work for both:
 * every address gets a code, so the limits, the stored code and its five
 * tries are the same for an address with an account and one without (D-121).
 * Only the email says which — "your sign-in code" or "your code to create an
 * account" — and only the inbox's owner reads it.
 *
 * Limits come first, and count every address: one code email a minute and
 * five an hour per address, shared with reset codes; thirty in five minutes
 * per IP (D-135).
 */
@CommandHandler(SendEmailCodeCommand)
export class SendEmailCodeHandler implements ICommandHandler<SendEmailCodeCommand> {
    constructor(
        @Inject(USER_DIRECTORY) private readonly directory: UserDirectoryPort,
        @Inject(RATE_LIMIT) private readonly limiter: RateLimitPort,
        private readonly codeIssuer: CodeIssuer
    ) {}

    async execute({ email, language, ip }: SendEmailCodeCommand): Promise<void> {
        const address = normaliseEmail(email)
        await enforce(this.limiter, [
            [AUTH_RATE_LIMITS.codeEmailsPerIp, ip],
            [AUTH_RATE_LIMITS.codeEmailsPerEmailMinute, address],
            [AUTH_RATE_LIMITS.codeEmailsPerEmailHour, address]
        ])

        const account = await this.directory.findByEmail(address)
        await this.codeIssuer.issue(address, 'sign-in', new Date(), {
            language,
            accountExists: account !== null,
            name: account?.displayName ?? undefined
        })
    }
}
