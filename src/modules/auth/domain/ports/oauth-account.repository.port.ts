/**
 * OAuth Account Repository Port — which user a provider's person is.
 */
export interface OAuthAccountRepositoryPort {
    /** The user linked to this provider's person, deleted or not. */
    findUserId(provider: string, subject: string): Promise<string | null>

    /**
     * Link the provider's person to the user. Does nothing if that exact link
     * exists already.
     * @returns false if the person is linked to another user (a concurrent sign-in won)
     */
    link(userId: string, provider: string, subject: string): Promise<boolean>

    /** The providers linked to the user, by id (`google`), sorted. */
    providersOf(userId: string): Promise<string[]>

    /** Remove every link of the user. */
    deleteForUser(userId: string): Promise<void>

    /** Remove the links of deleted accounts. @returns how many */
    deleteForDeletedAccounts(): Promise<number>
}

export const OAUTH_ACCOUNT_REPOSITORY = Symbol('OAuthAccountRepositoryPort')
