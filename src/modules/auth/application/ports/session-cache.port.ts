/**
 * Session Cache Port — what the application tells the cache in front of the
 * access-token check, and the short memory refresh-token rotation needs.
 */
export interface SessionCachePort {
    /** These sessions have ended: stop honouring their access tokens now. */
    invalidateSessions(sessionIds: string[]): Promise<void>

    /** The user's record changed (profile, roles, deletion). */
    invalidateUser(userId: string): Promise<void>

    /**
     * Remember, briefly, the refresh token that replaced another, so a second
     * refresh with the old one in the same moment can be given the same new
     * token rather than treated as theft. Only the hash of the old token is
     * used as the key.
     */
    rememberReplacement(oldTokenHash: string, newToken: string, ttlMs: number): Promise<void>

    recallReplacement(oldTokenHash: string): Promise<string | null>
}

export const SESSION_CACHE = Symbol('SessionCachePort')
