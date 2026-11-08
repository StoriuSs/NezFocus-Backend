import { Inject, Injectable } from '@nestjs/common'
import { displayNameFrom, UserEntity, UserRepositoryPort, USER_REPOSITORY } from '@/modules/users/domain'
import {
    AccountCompletionInput,
    DirectoryUser,
    UserDirectoryPort
} from '@/modules/users/application/ports/user-directory.port'

const toDirectoryUser = (user: UserEntity): DirectoryUser => ({
    id: user.id,
    email: user.email,
    roles: user.roles,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    completedAt: user.completedAt,
    deletedAt: user.deletedAt,
    deletionRequestedAt: user.deletionRequestedAt
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
        // The provider's display name is the person's to set there: cut it
        // to the profile's rules (REQ-AUTH-10, D-139), or drop it.
        const user = await this.users.createWithEmail(email, { displayName: displayNameFrom(displayName) })
        return user ? toDirectoryUser(user) : null
    }

    async complete(id: string, input: AccountCompletionInput): Promise<DirectoryUser | null> {
        const user = await this.users.complete(id, input)
        return user ? toDirectoryUser(user) : null
    }

    languageOf(id: string): Promise<string | null> {
        return this.users.findLanguage(id)
    }

    timeZoneOf(id: string): Promise<string | null> {
        return this.users.findTimeZone(id)
    }

    async requestDeletion(id: string, at: Date): Promise<DirectoryUser | null> {
        const user = await this.users.requestDeletion(id, at)
        return user ? toDirectoryUser(user) : null
    }

    cancelDeletion(id: string): Promise<boolean> {
        return this.users.cancelDeletion(id)
    }
}
