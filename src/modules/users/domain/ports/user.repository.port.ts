import { UserEntity } from '../entities/user.entity'

/**
 * User Repository Port (Outbound)
 *
 * Defines what the application layer NEEDS from persistence.
 * The domain/application layer depends on this interface.
 * The infrastructure layer provides the concrete implementation.
 *
 * This interface must NEVER import ORM-specific types (Prisma, TypeORM, etc.)
 *
 * Every write that depends on the row's current state is a single conditional
 * statement, not a read followed by a write: requests for the same user run
 * concurrently (double-clicks, retries, several tabs).
 */
export interface UserRepositoryPort {
    /** A live (not soft-deleted) user. */
    findById(id: string): Promise<UserEntity | null>
    findByUsername(username: string): Promise<UserEntity | null>

    /**
     * Update a live user's profile fields.
     * Throws UsernameTakenError on unique violations, UserNotFoundError
     * if the user is gone or soft-deleted.
     */
    update(id: string, data: Partial<Pick<UserEntity, 'displayName' | 'bio'>>): Promise<UserEntity>

    /**
     * Atomically claim a username, only if one has not already been set.
     *
     * @returns the updated user, or null if the account already had a username
     */
    setUsernameIfUnset(id: string, username: string): Promise<UserEntity | null>

    /**
     * Point a live user at a new avatar, returning the key it replaced.
     *
     * Read-and-write in one statement: two concurrent uploads each get back the
     * key they actually replaced, so every superseded file is cleaned up. With
     * a separate read, both saw the same "previous" avatar and the first
     * upload's file was never deleted.
     *
     * @returns null if the user is gone or soft-deleted
     */
    replaceAvatar(id: string, avatarKey: string): Promise<{ user: UserEntity; previousAvatarKey: string | null } | null>

    /**
     * Soft-delete a live user. The returned entity reflects the row as it was
     * deleted, including the avatar it held at that moment.
     *
     * @returns null if the user was already deleted — so two concurrent
     *   deletions trigger the follow-up work once
     */
    softDelete(id: string, deletedBy: string): Promise<UserEntity | null>

    /**
     * Erase personal data from users soft-deleted before `deletedBefore`,
     * keeping the row so the account stays recognised and refused.
     *
     * @returns how many rows were erased
     */
    erasePersonalDataDeletedBefore(deletedBefore: Date): Promise<number>

    /** A user by id, soft-deleted or not. */
    findAnyById(id: string): Promise<UserEntity | null>

    /** A live user by sign-in address, whatever its case. */
    findLiveByEmail(email: string): Promise<UserEntity | null>

    /**
     * A new user with this address, stored lower case. Unverified unless
     * `verified` says otherwise: an address another provider (Google) has
     * already confirmed.
     *
     * @returns null if a live user already has it — two registrations racing
     *   for one address meet at the unique index, not at a check before it
     */
    createWithEmail(
        email: string,
        options?: { verified?: boolean; displayName?: string | null }
    ): Promise<UserEntity | null>

    markEmailVerified(id: string): Promise<void>

    /**
     * Hard-delete accounts never verified and created before `createdBefore`.
     * Without it, anyone could hold any address by registering it and never
     * confirming. Their credentials and codes go with them (foreign keys).
     *
     * @returns how many were deleted
     */
    deleteUnverifiedCreatedBefore(createdBefore: Date): Promise<number>

    /** Replace a user's roles. Only `pnpm user:promote` calls this. */
    setRoles(id: string, roles: string[]): Promise<UserEntity | null>
}

export const USER_REPOSITORY = Symbol('UserRepositoryPort')
