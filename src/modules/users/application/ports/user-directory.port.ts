/**
 * User Directory Port — what the users module offers other modules.
 *
 * The auth module signs people in, but the user record is this module's. So
 * instead of auth reading the users table, this module publishes the few
 * operations auth needs, in terms of a small record rather than the domain
 * entity. The dependency runs one way: auth depends on this interface; nothing
 * here knows auth exists. servers uses it too, for people's pictures.
 */
export interface DirectoryUser {
    id: string
    /** Lower case. Null only for an account whose personal data was erased. */
    email: string | null
    roles: string[]
    username: string | null
    displayName: string | null
    /** The stored picture's key, not an address: `avatarUrl` turns it into one. */
    avatarUrl: string | null
    bio: string | null
    /** When the "complete your account" step was done; null until then (D-61). */
    completedAt: Date | null
    deletedAt: Date | null
    /**
     * When the owner asked to delete the account; null when they have not.
     * Such an account is still live until the 14 days are over (D-141).
     */
    deletionRequestedAt: Date | null
}

/** The "complete your account" step, checked by the caller (D-61). */
export interface AccountCompletionInput {
    /** 1-32 characters, trimmed. */
    displayName: string
    /** Already normalised and matching USERNAME_PATTERN. */
    username: string
    /**
     * The new password's hash, written with the rest or not at all: a
     * completion that loses (another tab first, the username taken) leaves
     * the password as it was (Kiểm 2 review).
     */
    passwordHash: string
    /** From canonicalTimeZone. */
    timezone: string
    language: string
    /** Now: also when the Terms were agreed to. */
    completedAt: Date
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

    /**
     * Finish an account: name, username, Terms, first settings — at once,
     * and only if it is not completed yet, with the password in the same
     * transaction.
     * @throws UsernameTakenError (USERNAME_CONFLICT) when a live account has
     *   the username, decided as it is written
     * @returns null if the account is gone or was already completed
     */
    complete(id: string, input: AccountCompletionInput): Promise<DirectoryUser | null>

    /**
     * The language the account chose, for emails nobody asked for (D-132).
     * Null before the account is completed.
     */
    languageOf(id: string): Promise<string | null>

    /** The time zone the account chose, to write dates in its emails. Null before it is completed. */
    timeZoneOf(id: string): Promise<string | null>

    /**
     * Record that the owner asked to delete the account (REQ-AUTH-09, D-141);
     * the users module's sweep deletes it 14 days later.
     * @returns null if the account is gone, incomplete or already waiting
     */
    requestDeletion(id: string, at: Date): Promise<DirectoryUser | null>

    /**
     * Take the request back: the owner signed in and chose to restore it.
     * @returns false if it was not waiting to be deleted, or is gone
     */
    cancelDeletion(id: string): Promise<boolean>

    /**
     * A stored picture key (the `avatarUrl` column holds keys) as an address
     * the browser can open: a presigned one on a private S3 bucket. For lists
     * other modules show, such as a server's members.
     */
    avatarUrl(key: string | null): Promise<string | null>
}

export const USER_DIRECTORY = Symbol('UserDirectoryPort')
