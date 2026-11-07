import { EventBus } from '@nestjs/cqrs'
import { RemoveAvatarHandler } from './remove-avatar.handler'
import { RemoveAvatarCommand } from './remove-avatar.command'
import { UserEntity, UserNotFoundError, UserRepositoryPort } from '@/modules/users/domain'
import { AvatarRemovedEvent } from '../../events/avatar-removed.event'
import { UserProfileUpdatedEvent } from '../../events/user-profile-updated.event'

// DELETE /users/me/avatar (D-72): the picture goes, and so does its file.
describe('RemoveAvatarHandler', () => {
    function world() {
        const userRepo = { replaceAvatar: jest.fn() }
        const eventBus = { publish: jest.fn() }
        const handler = new RemoveAvatarHandler(
            userRepo as unknown as UserRepositoryPort,
            eventBus as unknown as EventBus
        )
        return { userRepo, eventBus, handler }
    }

    it('clears the avatar, has its file deleted, and refreshes the cached profile', async () => {
        const { userRepo, eventBus, handler } = world()
        userRepo.replaceAvatar.mockResolvedValue({
            user: new UserEntity({ id: 'user-1', avatarUrl: null }),
            previousAvatarKey: 'avatars/old.webp'
        })

        await handler.execute(new RemoveAvatarCommand('user-1'))

        expect(userRepo.replaceAvatar).toHaveBeenCalledWith('user-1', null)
        expect(eventBus.publish).toHaveBeenCalledWith(new AvatarRemovedEvent('user-1', 'avatars/old.webp'))
        expect(eventBus.publish).toHaveBeenCalledWith(new UserProfileUpdatedEvent('user-1'))
    })

    it('does nothing more when there was no avatar: asking twice is fine', async () => {
        const { userRepo, eventBus, handler } = world()
        userRepo.replaceAvatar.mockResolvedValue({
            user: new UserEntity({ id: 'user-1', avatarUrl: null }),
            previousAvatarKey: null
        })

        await handler.execute(new RemoveAvatarCommand('user-1'))

        expect(eventBus.publish).not.toHaveBeenCalled()
    })

    it('refuses for an account that is gone', async () => {
        const { userRepo, handler } = world()
        userRepo.replaceAvatar.mockResolvedValue(null)

        await expect(handler.execute(new RemoveAvatarCommand('user-1'))).rejects.toThrow(UserNotFoundError)
    })
})
