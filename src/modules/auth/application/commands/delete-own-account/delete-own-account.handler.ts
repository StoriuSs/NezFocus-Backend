import { CommandBus, CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Inject } from '@nestjs/common'
import { DeleteOwnAccountCommand } from './delete-own-account.command'
import { DeleteAccountCommand, USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import {
    AccountDisabledError,
    ConfirmationRequiredError,
    CREDENTIAL_REPOSITORY,
    CredentialRepositoryPort,
    CurrentPasswordInvalidError
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
import { AUTH_RATE_LIMITS } from '../../rate-limits'
import { withGuess } from '../../services/limits'

/**
 * Delete your own account, proving it is you first with the password: a
 * signed-in session alone is not enough, or anyone at an unlocked computer
 * could do it (REQ-AUTH-09).
 *
 * Only the password: every account sets one when it is completed (D-61,
 * D-130). An account without one (made with Google before that rule) chooses
 * one with "forgot password" first. Wrong passwords count as when changing it.
 * Then the users module deletes the account (and its sessions, by its event),
 * and the owner is emailed.
 */
@CommandHandler(DeleteOwnAccountCommand)
export class DeleteOwnAccountHandler implements ICommandHandler<DeleteOwnAccountCommand> {
    constructor(
        @Inject(USER_DIRECTORY) private readonly directory: UserDirectoryPort,
        @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepositoryPort,
        @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasherPort,
        @Inject(RATE_LIMIT) private readonly limiter: RateLimitPort,
        @Inject(AUTH_MAILER) private readonly mailer: AuthMailerPort,
        @Inject(AUTH_EVENTS) private readonly events: AuthEventsPort,
        private readonly commandBus: CommandBus
    ) {}

    async execute({ userId, proof, language }: DeleteOwnAccountCommand): Promise<void> {
        const user = await this.directory.findById(userId)
        if (!user || user.deletedAt) throw new AccountDisabledError()

        const hash = await this.credentials.findHash(userId)
        if (hash === null || !proof.password) throw new ConfirmationRequiredError(['password'])
        await this.checkPassword(userId, hash, proof.password)

        await this.commandBus.execute(new DeleteAccountCommand(userId, userId))
        await this.limiter.reset(AUTH_RATE_LIMITS.currentPasswordFailuresPerUser, userId)
        if (user.email) await this.mailer.sendAccountDeleted(user.email, language)
        this.events.record('account_deleted')
    }

    /** As when changing it: wrong ones count against the user. */
    private async checkPassword(userId: string, hash: string, password: string): Promise<void> {
        await withGuess(this.limiter, [[AUTH_RATE_LIMITS.currentPasswordFailuresPerUser, userId]], async (guess) => {
            if (!(await this.hasher.verify(hash, password))) {
                guess.wrong()
                throw new CurrentPasswordInvalidError()
            }
        })
    }
}
