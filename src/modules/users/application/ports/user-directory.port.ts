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
    emailVerified: boolean
    roles: string[]
    username: string | null
    displayName: string | null
    avatarUrl: string | null
    bio: string | null
    hasSetUsername: boolean
    deletedAt: Date | null
}

export interface UserDirectoryPort {
    /** A live account by address, whatever its case. */
    findByEmail(email: string): Promise<DirectoryUser | null>

    /** An account by id, deleted or not — so a deleted one can be refused by name. */
    findById(id: string): Promise<DirectoryUser | null>

    /**
     * A new, unverified account for the address.
     * @returns null if a live account already has it (a concurrent registration)
     */
    createUnverified(email: string): Promise<DirectoryUser | null>

    /**
     * A new account whose address another provider has already confirmed
     * (signing in with Google). No password.
     * @returns null if a live account already has it (a concurrent sign-up)
     */
    createVerified(email: string, displayName: string | null): Promise<DirectoryUser | null>

    markEmailVerified(id: string): Promise<void>
}

export const USER_DIRECTORY = Symbol('UserDirectoryPort')
