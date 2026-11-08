import { UserEntity } from '../entities/user.entity'

/** What the "complete your account" step writes (D-61). Already checked. */
export interface AccountCompletion {
    displayName: string
    /** Normalised: lower case, trimmed. */
    username: string
    /** Stored with the completion or not at all (the Credential row of auth). */
    passwordHash: string
    /** An IANA zone name (canonicalTimeZone). */
    timezone: string
    language: string
    /** When the owner ticked the Terms box: now. */
    completedAt: Date
}

/** An account the sweep deleted. */
export interface DeletedAccount {
    id: string
    /** Its owner asked (D-141); false: a sign-up left incomplete. */
    ownerAsked: boolean
}

/** A deleted account whose avatar file has not been queued for removal yet. */
export interface LeftoverAvatar {
    id: string
    avatarKey: string
}

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
     * Finish a live, not yet completed account: its name, username, the time
     * the Terms were agreed to, and its first settings, together. Conditional
     * on the account still being incomplete, in the same statement, so two
     * submissions at once complete it once.
     *
     * @throws UsernameTakenError when a live account holds the username — the
     *   unique index decides, at the moment of writing (REQ-AUTH-01)
     * @returns null if the account is gone or already completed
     */
    complete(id: string, completion: AccountCompletion): Promise<UserEntity | null>

    /** The language chosen in the settings, or null before there are any. */
    findLanguage(id: string): Promise<string | null>

    /** The time zone chosen in the settings, or null before there are any. */
    findTimeZone(id: string): Promise<string | null>

    /**
     * Point a live user at a new avatar, or at none (null), returning the key it replaced.
     *
     * Read-and-write in one statement: two concurrent uploads each get back the
     * key they actually replaced, so every superseded file is cleaned up. With
     * a separate read, both saw the same "previous" avatar and the first
     * upload's file was never deleted.
     *
     * @returns null if the user is gone or soft-deleted
     */
    replaceAvatar(
        id: string,
        avatarKey: string | null
    ): Promise<{ user: UserEntity; previousAvatarKey: string | null } | null>

    /**
     * Record that the owner of a live, completed account asked to delete it
     * (REQ-AUTH-09, D-141). Conditional in the statement itself: of two
     * requests at once, one records it.
     *
     * @returns null if the account is gone, deleted, incomplete, or already
     *   waiting to be deleted
     */
    requestDeletion(id: string, at: Date): Promise<UserEntity | null>

    /**
     * Take back a request to delete a live account. Conditional, like the
     * sweep's deletion, so the two cannot both win.
     *
     * @returns false if the account was not waiting to be deleted, or is gone
     */
    cancelDeletion(id: string): Promise<boolean>

    /**
     * Delete the accounts whose time has come (dueForDeletion): mark them
     * deleted and erase their personal data and settings, in one statement per
     * account, re-checked under the row lock so a restore or a completion that
     * lands first wins. The row stays, empty, so what points to it still works.
     *
     * The avatar key alone is kept: it is how the file is found and removed
     * (findAvatarsOfDeleted), and is forgotten only once that removal is queued.
     *
     * @returns each account deleted
     */
    deleteDue(due: { requestedBy: Date; incompleteSince: Date }, now: Date): Promise<DeletedAccount[]>

    /** Up to `limit` deleted accounts that still hold an avatar key. */
    findAvatarsOfDeleted(limit: number): Promise<LeftoverAvatar[]>

    /** Forget the avatar keys of these deleted accounts; live ones are left alone. */
    forgetAvatarsOfDeleted(ids: string[]): Promise<void>

    /** A user by id, soft-deleted or not. */
    findAnyById(id: string): Promise<UserEntity | null>

    /** A live user by sign-in address, whatever its case. */
    findLiveByEmail(email: string): Promise<UserEntity | null>

    /**
     * A new user with this address, stored lower case. The caller has
     * confirmed the address (a code sent to it, or a provider): there is no
     * unconfirmed account (D-133).
     *
     * @returns null if a live user already has it — two sign-ups racing for
     *   one address meet at the unique index, not at a check before it
     */
    createWithEmail(email: string, options?: { displayName?: string | null }): Promise<UserEntity | null>

    /** Replace a user's roles. Only `pnpm user:promote` calls this. */
    setRoles(id: string, roles: string[]): Promise<UserEntity | null>
}

export const USER_REPOSITORY = Symbol('UserRepositoryPort')
