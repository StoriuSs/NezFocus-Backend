export interface SessionRecord {
    id: string
    userId: string
    expiresAt: Date
}

export type RevokeReason =
    | 'logout'
    | 'logout-all'
    | 'password-changed'
    | 'password-reset'
    | 'reuse-detected'
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
 *             when the token was known)
 */
export type RotationOutcome =
    | { kind: 'rotated'; session: SessionRecord }
    | { kind: 'grace'; session: SessionRecord }
    | { kind: 'reused'; session: SessionRecord }
    | { kind: 'invalid'; ended?: SessionEnd }

export interface RotateInput {
    tokenHash: string
    newTokenHash: string
    now: Date
    graceMs: number
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

    /**
     * How a session that is not active ended; null for one that does not
     * exist, or is still active. A deleted account's sessions say so, even
     * before the event that revokes them has run.
     */
    findEnded(id: string, now: Date): Promise<SessionEnd | null>

    rotate(input: RotateInput): Promise<RotationOutcome>

    /** @returns the id of the session the token belonged to, if it was active */
    revokeByTokenHash(tokenHash: string, reason: RevokeReason, now: Date): Promise<string | null>

    /** @returns the ids of the sessions revoked */
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
