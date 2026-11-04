import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Inject } from '@nestjs/common'
import { SendPasswordSetCodeCommand } from './send-password-set-code.command'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { CodeInvalidError, PasswordAlreadySetError } from '@/modules/auth/domain'
import { AUTH_RATE_LIMITS } from '../../rate-limits'
import { RATE_LIMIT, RateLimitPort } from '../../ports'
import { CodeIssuer } from '../../services/code-issuer'
import { enforce } from '../../services/limits'
import { SignInMethods } from '../../services/sign-in-methods'

/**
 * Email the code that setting a first password needs (SetPasswordHandler):
 * only to an account that has no password yet.
 */
@CommandHandler(SendPasswordSetCodeCommand)
export class SendPasswordSetCodeHandler implements ICommandHandler<SendPasswordSetCodeCommand> {
    constructor(
        @Inject(USER_DIRECTORY) private readonly directory: UserDirectoryPort,
        @Inject(RATE_LIMIT) private readonly limiter: RateLimitPort,
        private readonly methods: SignInMethods,
        private readonly codeIssuer: CodeIssuer
    ) {}

    async execute({ userId }: SendPasswordSetCodeCommand): Promise<void> {
        const user = await this.directory.findById(userId)
        if (!user?.email || user.deletedAt) throw new CodeInvalidError()
        if ((await this.methods.of(userId)).password) throw new PasswordAlreadySetError()
        // The same limits as every code email to an address.
        await enforce(this.limiter, [
            [AUTH_RATE_LIMITS.codeEmailsPerEmailMinute, user.email],
            [AUTH_RATE_LIMITS.codeEmailsPerEmailHour, user.email]
        ])
        await this.codeIssuer.issue(userId, user.email, 'password-set', new Date(), {
            name: user.displayName ?? undefined
        })
    }
}
