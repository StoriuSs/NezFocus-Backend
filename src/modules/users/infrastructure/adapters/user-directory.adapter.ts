import { Inject, Injectable } from '@nestjs/common'
import { UserEntity, UserRepositoryPort, USER_REPOSITORY } from '@/modules/users/domain'
import { DirectoryUser, UserDirectoryPort } from '@/modules/users/application/ports/user-directory.port'

/** The profile form's limit (update-profile.request.dto.ts). */
const DISPLAY_NAME_MAX_LENGTH = 100

const toDirectoryUser = (user: UserEntity): DirectoryUser => ({
    id: user.id,
    email: user.email,
    roles: user.roles,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    hasSetUsername: user.hasSetUsername,
    completedAt: user.completedAt,
    deletedAt: user.deletedAt
})

/**
 * The users module's side of the User Directory: the published interface
 * other modules (auth) use, answered from this module's own repository.
 */
@Injectable()
export class UserDirectory implements UserDirectoryPort {
    constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepositoryPort) {}

    async findByEmail(email: string): Promise<DirectoryUser | null> {
        const user = await this.users.findLiveByEmail(email)
        return user ? toDirectoryUser(user) : null
    }

    async findById(id: string): Promise<DirectoryUser | null> {
        const user = await this.users.findAnyById(id)
        return user ? toDirectoryUser(user) : null
    }

    async create(email: string, displayName: string | null): Promise<DirectoryUser | null> {
        // The provider's display name is the person's to set there, not
        // checked here: bound it as the profile form does.
        const name = displayName?.trim().slice(0, DISPLAY_NAME_MAX_LENGTH) || null
        const user = await this.users.createWithEmail(email, { displayName: name })
        return user ? toDirectoryUser(user) : null
    }
}
