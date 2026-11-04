/**
 * Credential Repository Port — a user's password hash.
 */
export interface CredentialRepositoryPort {
    /** Null when the account has no password (never set, or from before this module). */
    findHash(userId: string): Promise<string | null>

    /** Create or replace. */
    setHash(userId: string, hash: string): Promise<void>

    /** Remove the password, if there is one. */
    delete(userId: string): Promise<void>

    /** Remove the passwords of deleted accounts. @returns how many */
    deleteForDeletedAccounts(): Promise<number>
}

export const CREDENTIAL_REPOSITORY = Symbol('CredentialRepositoryPort')
