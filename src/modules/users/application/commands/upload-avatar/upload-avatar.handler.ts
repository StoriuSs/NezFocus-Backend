import { CommandHandler, ICommandHandler, EventBus } from '@nestjs/cqrs'
import { Inject } from '@nestjs/common'
import { UploadAvatarCommand } from './upload-avatar.command'
import { USER_REPOSITORY, UserEntity, UserNotFoundError, UserRepositoryPort } from '@/modules/users/domain'
import { StoragePort, STORAGE, UploadedFileResult } from '../../ports'
import { AvatarUploadedEvent } from '../../events/avatar-uploaded.event'
import { UserProfileUpdatedEvent } from '../../events/user-profile-updated.event'

export interface UploadAvatarResult {
    user: UserEntity
    upload: UploadedFileResult
}

@CommandHandler(UploadAvatarCommand)
export class UploadAvatarHandler implements ICommandHandler<UploadAvatarCommand> {
    constructor(
        @Inject(USER_REPOSITORY) private readonly userRepo: UserRepositoryPort,
        @Inject(STORAGE) private readonly storage: StoragePort,
        private readonly eventBus: EventBus
    ) {}

    async execute(command: UploadAvatarCommand): Promise<UploadAvatarResult> {
        const uploadedFile = await this.storage.uploadAvatar(command.fileBuffer, command.originalName, command.userId)

        // Swap the avatar and learn which key it replaced in one statement.
        // Reading the current avatar first let two concurrent uploads both see
        // the same "previous" key, so the first upload's file was never
        // cleaned up.
        //
        // If the swap doesn't happen, delete the new file: nothing will ever
        // reference it — including when the account was deleted while the
        // image was being processed.
        let replaced: Awaited<ReturnType<UserRepositoryPort['replaceAvatar']>>
        try {
            replaced = await this.userRepo.replaceAvatar(command.userId, uploadedFile.key)
        } catch (error) {
            await this.storage.deleteFile(uploadedFile.key).catch(() => undefined)
            throw error
        }
        if (!replaced) {
            await this.storage.deleteFile(uploadedFile.key).catch(() => undefined)
            throw new UserNotFoundError(command.userId)
        }

        const { user, previousAvatarKey } = replaced
        if (previousAvatarKey) {
            this.eventBus.publish(new AvatarUploadedEvent(user.id, previousAvatarKey))
        }
        this.eventBus.publish(new UserProfileUpdatedEvent(user.id))

        return { user, upload: uploadedFile }
    }
}
