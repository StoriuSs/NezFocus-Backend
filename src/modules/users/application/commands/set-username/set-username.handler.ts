import { CommandHandler, ICommandHandler, EventBus } from '@nestjs/cqrs'
import { Inject } from '@nestjs/common'
import { SetUsernameCommand } from './set-username.command'
import { UserRepositoryPort, USER_REPOSITORY } from '@/modules/users/domain'
import { UserNotFoundError, UsernameAlreadySetError } from '@/modules/users/domain'
import { UserProfileUpdatedEvent } from '../../events/user-profile-updated.event'
import { UserEntity } from '@/modules/users/domain'

@CommandHandler(SetUsernameCommand)
export class SetUsernameHandler implements ICommandHandler<SetUsernameCommand> {
    constructor(
        @Inject(USER_REPOSITORY) private readonly userRepo: UserRepositoryPort,
        private readonly eventBus: EventBus
    ) {}

    async execute(command: SetUsernameCommand): Promise<UserEntity> {
        // 1. Check if user exists
        const user = await this.userRepo.findById(command.userId)
        if (!user) {
            throw new UserNotFoundError(command.userId)
        }

        // 2. Fail fast with a clear error for the common case
        if (user.hasSetUsername) {
            throw new UsernameAlreadySetError()
        }

        // 3. Claim the username atomically. The check above is a courtesy; this
        //    conditional write is what actually prevents two concurrent
        //    requests from both succeeding and the second overwriting the
        //    first. Repository throws UsernameTakenError on conflict.
        const updatedUser = await this.userRepo.setUsernameIfUnset(command.userId, command.username)
        if (!updatedUser) {
            throw new UsernameAlreadySetError()
        }

        // 4. Publish event for cache invalidation
        this.eventBus.publish(new UserProfileUpdatedEvent(updatedUser.id))

        return updatedUser
    }
}
