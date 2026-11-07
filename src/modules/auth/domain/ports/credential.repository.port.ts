/**
 * Credential Repository Port — a user's password hash.
 */
export interface CredentialRepositoryPort {
    /** Null when the account has no password (never set, or from before this module). */
    findHash(userId: string): Promise<string | null>

    /** Create or replace. */
    setHash(userId: string, hash: string): Promise<void>

    /**
     * Replace the hash only if it is still `expected`: re-hashing an old
     * password must not undo a change made meanwhile. @returns whether it did
     */
    replaceHash(userId: string, expected: string, hash: string): Promise<boolean>

    /** Remove the password, if there is one. */
    delete(userId: string): Promise<void>

    /** Remove the passwords of deleted accounts. @returns how many */
    deleteForDeletedAccounts(): Promise<number>
}

export const CREDENTIAL_REPOSITORY = Symbol('CredentialRepositoryPort')
