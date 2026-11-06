/**
 * User Directory Port — what the users module offers other modules.
 *
 * The auth module signs people in, but the user record is this module's. So
 * instead of auth reading the users table, this module publishes the few
 * operations auth needs, in terms of a small record rather than the domain
 * entity. The dependency runs one way: auth depends on this interface; nothing
 * here knows auth exists.
 */
export interface DirectoryUser {
    id: string
    /** Lower case. Null only for an account whose personal data was erased. */
    email: string | null
    roles: string[]
    username: string | null
    displayName: string | null
    avatarUrl: string | null
    bio: string | null
    hasSetUsername: boolean
    /** When the "complete your account" step was done; null until then (D-61). */
    completedAt: Date | null
    deletedAt: Date | null
}

export interface UserDirectoryPort {
    /** A live account by address, whatever its case. */
    findByEmail(email: string): Promise<DirectoryUser | null>

    /** An account by id, deleted or not — so a deleted one can be refused by name. */
    findById(id: string): Promise<DirectoryUser | null>

    /**
     * A new account for an address its owner has just proved they read: the
     * code sent to it was right, or a provider (Google) verified it. No
     * password, no username, not completed yet (D-59, D-61).
     * @returns null if a live account already has it (a concurrent sign-up)
     */
    create(email: string, displayName: string | null): Promise<DirectoryUser | null>
}

export const USER_DIRECTORY = Symbol('UserDirectoryPort')
