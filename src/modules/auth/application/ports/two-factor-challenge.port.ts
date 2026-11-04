/**
 * Two-Step Challenge Port — a sign-in waiting for its second step. The first
 * step (password, emailed code or Google) is done; the challenge says for whom,
 * for a few minutes, with a few attempts.
 */
export interface TwoFactorChallengePort {
    /** @returns the challenge: an opaque value for the client to send back */
    create(userId: string, ttlSeconds: number): Promise<string>

    /** Whose challenge it is; null if unknown, used up or expired. */
    find(challenge: string): Promise<string | null>

    /**
     * Count a wrong code. The challenge ends at the last attempt.
     * @returns how many attempts are left (0: it has ended)
     */
    recordFailure(challenge: string, maxAttempts: number): Promise<number>

    /** End it: the second step is done. @returns whose it was; null if it had already ended */
    take(challenge: string): Promise<string | null>
}

export const TWO_FACTOR_CHALLENGE = Symbol('TwoFactorChallengePort')
