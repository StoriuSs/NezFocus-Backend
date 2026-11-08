export interface SessionRecord {
    id: string
    userId: string
    expiresAt: Date
}

/**
 * Why a session was ended. `logout-all` is "Sign out the other devices"
 * (D-75; the value predates the button keeping this device); `revoked` is
 * one row of the list of sessions. `deletion-requested`: the owner asked to
 * delete the account, which waits 14 days (D-141); `account-deleted`: it is
 * deleted.
 */
export type RevokeReason =
    | 'logout'
    | 'logout-all'
    | 'revoked'
    | 'password-changed'
    | 'password-reset'
    | 'reuse-detected'
    | 'deletion-requested'
    | 'account-deleted'

/** How a session that no longer works came to an end. */
export type SessionEnd = RevokeReason | 'expired'

/**
 * What presenting a refresh token led to.
 *
 * - rotated — it was current: it is now used, and `newTokenHash` replaces it
 * - grace   — it was used moments ago and its replacement not yet; the same
 *             replacement should be handed back (two tabs refreshing at once)
 * - reused  — it was used earlier than that: presumed stolen. The session has
 *             been revoked
 * - invalid — unknown, expired, or its session has ended (`ended`: how,
 *             when the token was known; `deletesAt`: when the account goes,
 *             when it ended because its owner asked to delete it)
 */
export type RotationOutcome =
    | { kind: 'rotated'; session: SessionRecord }
    | { kind: 'grace'; session: SessionRecord }
    | { kind: 'reused'; session: SessionRecord }
    | { kind: 'invalid'; ended?: SessionEnd; deletesAt?: Date }

/** A session as the list of sessions reads it: the stored user agent and IP, unread and unmasked. */
export interface ActiveSession {
    id: string
    createdAt: Date
    lastUsedAt: Date
    userAgent: string | null
    ip: string | null
}

/** Where a request came from: kept on its session (D-138). */
export interface SessionClient {
    ip?: string
    userAgent?: string
}

export interface RotateInput {
    tokenHash: string
    newTokenHash: string
    now: Date
    graceMs: number
    /** Recorded on the session with its last use when the token rotates; what is missing stays as it was. */
    client?: SessionClient
    /**
     * Runs after the rotation is decided and before it is committed, while the
     * old token's row is still locked. A second refresh with the same token
     * waits on that lock, so whatever this stores is there when it looks.
     */
    beforeCommit: () => Promise<void>
}

/**
 * Session Repository Port — sign-ins, and the refresh tokens issued in them.
 */
export interface SessionRepositoryPort {
    create(input: {
        userId: string
        expiresAt: Date
        refreshTokenHash: string
        userAgent?: string
        ip?: string
    }): Promise<SessionRecord>

    /** A session that has not been revoked and has not expired. */
    findActive(id: string, now: Date): Promise<SessionRecord | null>

    /** The user's sessions that have not been revoked and have not expired, in no order. */
    listActive(userId: string, now: Date): Promise<ActiveSession[]>

    /**
     * How a session that is not active ended; null for one that does not
     * exist, or is still active. A deleted account's sessions say so, even
     * before the event that revokes them has run. One ended by a request to
     * delete the account that was then taken back reads `revoked`.
     */
    findEnded(id: string, now: Date): Promise<SessionEnd | null>

    rotate(input: RotateInput): Promise<RotationOutcome>

    /** @returns the id of the session the token belonged to, if it was active */
    revokeByTokenHash(tokenHash: string, reason: RevokeReason, now: Date): Promise<string | null>

    /**
     * End one session, if it is the user's. @returns whether it is theirs,
     * whether or not it was still active: a retry after a failure must reach
     * the cache again.
     */
    revokeOne(userId: string, sessionId: string, reason: RevokeReason, now: Date): Promise<boolean>

    /** End the user's live sessions, all or all but one. @returns the ids of those it ended */
    revokeAllForUser(userId: string, reason: RevokeReason, now: Date, exceptSessionId?: string): Promise<string[]>

    /** Remove sessions that ended long enough ago that nothing can use them. */
    deleteEnded(before: Date): Promise<number>

    /**
     * End the sessions still open on deleted accounts: those whose deletion
     * event was lost. @returns their ids
     */
    revokeForDeletedAccounts(now: Date): Promise<string[]>
}

export const SESSION_REPOSITORY = Symbol('SessionRepositoryPort')
