import { CommandHandler, ICommandHandler, EventBus } from '@nestjs/cqrs'
import { Inject } from '@nestjs/common'
import { RemoveAvatarCommand } from './remove-avatar.command'
import { USER_REPOSITORY, UserNotFoundError, UserRepositoryPort } from '@/modules/users/domain'
import { AvatarRemovedEvent } from '../../events/avatar-removed.event'
import { UserProfileUpdatedEvent } from '../../events/user-profile-updated.event'

/**
 * DELETE /users/me/avatar (S-ME-02, D-72). The same one-statement swap as an
 * upload, to no avatar: an upload racing this one either lands first (and is
 * removed here, its file with it) or after (and stays). Without an avatar
 * there is nothing to do, so a repeated request is answered the same way.
 */
@CommandHandler(RemoveAvatarCommand)
export class RemoveAvatarHandler implements ICommandHandler<RemoveAvatarCommand> {
    constructor(
        @Inject(USER_REPOSITORY) private readonly userRepo: UserRepositoryPort,
        private readonly eventBus: EventBus
    ) {}

    async execute(command: RemoveAvatarCommand): Promise<void> {
        const replaced = await this.userRepo.replaceAvatar(command.userId, null)
        if (!replaced) throw new UserNotFoundError(command.userId)
        if (!replaced.previousAvatarKey) return

        this.eventBus.publish(new AvatarRemovedEvent(command.userId, replaced.previousAvatarKey))
        this.eventBus.publish(new UserProfileUpdatedEvent(command.userId))
    }
}
