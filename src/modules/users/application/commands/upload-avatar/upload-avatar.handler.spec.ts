import { EventBus } from '@nestjs/cqrs'
import { UploadAvatarHandler } from './upload-avatar.handler'
import { UploadAvatarCommand } from './upload-avatar.command'
import { UserEntity, UserNotFoundError, UserRepositoryPort } from '@/modules/users/domain'
import { StoragePort, UploadedFileResult } from '../../ports'
import { AvatarUploadedEvent } from '../../events/avatar-uploaded.event'

describe('UploadAvatarHandler', () => {
    it('leaves no file behind: cleans up the key it replaced, or the new file when the account is gone or the write fails', async () => {
        const uploaded: UploadedFileResult = { key: 'avatars/new.webp', width: 256, height: 256 }
        const userRepo = { replaceAvatar: jest.fn() }
        const storage = {
            uploadAvatar: jest.fn().mockResolvedValue(uploaded),
            deleteFile: jest.fn().mockResolvedValue(undefined)
        }
        const eventBus = { publish: jest.fn() }
        const handler = new UploadAvatarHandler(
            userRepo as unknown as UserRepositoryPort,
            storage as unknown as StoragePort,
            eventBus as unknown as EventBus
        )
        const command = new UploadAvatarCommand('user-123', Buffer.from('image'), 'avatar.png')

        userRepo.replaceAvatar.mockResolvedValueOnce({
            user: new UserEntity({ id: 'user-123', avatarUrl: uploaded.key }),
            previousAvatarKey: 'avatars/old.webp'
        })
        await handler.execute(command)
        expect(eventBus.publish).toHaveBeenCalledWith(new AvatarUploadedEvent('user-123', 'avatars/old.webp'))
        expect(storage.deleteFile).not.toHaveBeenCalled()

        userRepo.replaceAvatar.mockResolvedValueOnce(null)
        await expect(handler.execute(command)).rejects.toThrow(UserNotFoundError)
        expect(storage.deleteFile).toHaveBeenLastCalledWith('avatars/new.webp')

        storage.deleteFile.mockClear()
        userRepo.replaceAvatar.mockRejectedValueOnce(new Error('connection lost'))
        await expect(handler.execute(command)).rejects.toThrow('connection lost')
        expect(storage.deleteFile).toHaveBeenCalledWith('avatars/new.webp')
    })
})
