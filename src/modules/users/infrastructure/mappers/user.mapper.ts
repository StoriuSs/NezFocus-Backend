import { UserEntity } from '@/modules/users/domain'
import { User } from '@/generated/prisma/client'

/**
 * User Mapper
 *
 * Converts between the Prisma-generated User type and the domain UserEntity.
 * This is the ONLY file that knows about both the domain entity and the ORM type.
 */
export class UserMapper {
    /**
     * Map Prisma User → Domain UserEntity
     */
    static toDomain(prismaUser: User): UserEntity {
        return new UserEntity({
            id: prismaUser.id,
            username: prismaUser.username,
            email: prismaUser.email,
            roles: prismaUser.roles,
            displayName: prismaUser.displayName,
            avatarUrl: prismaUser.avatarUrl,
            bio: prismaUser.bio,
            completedAt: prismaUser.completedAt,
            termsAcceptedAt: prismaUser.termsAcceptedAt,
            createdAt: prismaUser.createdAt,
            updatedAt: prismaUser.updatedAt,
            deletedAt: prismaUser.deletedAt,
            deletedBy: prismaUser.deletedBy
        })
    }

    /**
     * Map Domain UserEntity → Prisma-compatible data for create/update
     * Only includes mutable fields (excludes id, createdAt, etc.)
     */
    static toPersistence(entity: Partial<UserEntity>): Partial<User> {
        const data: Record<string, unknown> = {}

        if (entity.username !== undefined) data.username = entity.username
        if (entity.email !== undefined) data.email = entity.email
        if (entity.displayName !== undefined) data.displayName = entity.displayName
        if (entity.avatarUrl !== undefined) data.avatarUrl = entity.avatarUrl
        if (entity.bio !== undefined) data.bio = entity.bio
        if (entity.deletedAt !== undefined) data.deletedAt = entity.deletedAt
        if (entity.deletedBy !== undefined) data.deletedBy = entity.deletedBy

        return data as Partial<User>
    }
}
