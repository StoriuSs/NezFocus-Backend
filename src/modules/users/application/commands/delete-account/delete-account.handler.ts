import { CommandHandler, ICommandHandler, EventBus } from '@nestjs/cqrs'
import { Inject } from '@nestjs/common'
import { DeleteAccountCommand } from './delete-account.command'
import { UserRepositoryPort, USER_REPOSITORY } from '@/modules/users/domain'
import { UserNotFoundError } from '@/modules/users/domain'
import { AccountDeletedEvent } from '../../events/account-deleted.event'

@CommandHandler(DeleteAccountCommand)
export class DeleteAccountHandler implements ICommandHandler<DeleteAccountCommand> {
    constructor(
        @Inject(USER_REPOSITORY) private readonly userRepo: UserRepositoryPort,
        private readonly eventBus: EventBus
    ) {}

    async execute(command: DeleteAccountCommand): Promise<void> {
        // One conditional write, not find-then-update: a concurrent second
        // deletion finds nothing to delete (404) instead of publishing the
        // follow-up work twice, and the avatar key comes from the row as it was
        // deleted, not from an earlier read an upload could have overtaken.
        const deleted = await this.userRepo.softDelete(command.userId, command.actorId || command.userId)
        if (!deleted) {
            throw new UserNotFoundError(command.userId)
        }

        // Handlers purge what the account leaves behind.
        this.eventBus.publish(new AccountDeletedEvent(deleted.id, deleted.avatarUrl))
    }
}
