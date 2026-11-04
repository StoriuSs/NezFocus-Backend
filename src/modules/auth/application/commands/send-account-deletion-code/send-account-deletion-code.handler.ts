import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Inject } from '@nestjs/common'
import { SendAccountDeletionCodeCommand } from './send-account-deletion-code.command'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import {
    AccountDisabledError,
    CREDENTIAL_REPOSITORY,
    CredentialRepositoryPort,
    UsePasswordError
} from '@/modules/auth/domain'
import { AUTH_RATE_LIMITS } from '../../rate-limits'
import { RATE_LIMIT, RateLimitPort } from '../../ports'
import { CodeIssuer } from '../../services/code-issuer'
import { enforce } from '../../services/limits'

/**
 * An account made with Google has no password to confirm a deletion with: a
 * code goes to its inbox instead. One with a password uses that.
 */
@CommandHandler(SendAccountDeletionCodeCommand)
export class SendAccountDeletionCodeHandler implements ICommandHandler<SendAccountDeletionCodeCommand> {
    constructor(
        @Inject(USER_DIRECTORY) private readonly directory: UserDirectoryPort,
        @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepositoryPort,
        @Inject(RATE_LIMIT) private readonly limiter: RateLimitPort,
        private readonly codeIssuer: CodeIssuer
    ) {}

    async execute({ userId }: SendAccountDeletionCodeCommand): Promise<void> {
        const user = await this.directory.findById(userId)
        if (!user?.email || user.deletedAt) throw new AccountDisabledError()
        if ((await this.credentials.findHash(userId)) !== null) throw new UsePasswordError()
        // The same limits as every code email to an address.
        await enforce(this.limiter, [
            [AUTH_RATE_LIMITS.codeEmailsPerEmailMinute, user.email],
            [AUTH_RATE_LIMITS.codeEmailsPerEmailHour, user.email]
        ])
        await this.codeIssuer.issue(userId, user.email, 'account-delete', new Date(), {
            name: user.displayName ?? undefined
        })
    }
}
