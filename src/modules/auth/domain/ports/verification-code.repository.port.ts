/**
 * What a code is for (D-129). A sign-in code signs in to the account of the
 * address, or makes one if it has none (D-59, D-60); a reset code chooses a new
 * password. One never works as the other: the purpose is part of the key and
 * of the hash.
 */
export type CodePurpose = 'sign-in' | 'password-reset'

/**
 * A guess at a code:
 * - `right`: the newest code for the address, in time and within its tries.
 *   Not used up yet: the caller uses it once whatever else it checks passed.
 * - `wrong`: a wrong guess, or no code was ever sent.
 * - `expired`: past its ten minutes, or its tries are used up (this guess
 *   included), whether or not this guess was right.
 */
export type CodeCheck = 'right' | 'wrong' | 'expired'

/**
 * Verification Code Repository Port: one live code per address and purpose,
 * whether or not the address has an account (D-121, D-129).
 */
export interface VerificationCodeRepositoryPort {
    /** Store a new code, replacing any earlier one for the address and purpose. */
    replace(email: string, purpose: CodePurpose, codeHash: string, expiresAt: Date): Promise<void>

    /**
     * Check a guess, counting it as one of the code's tries. Concurrent
     * guesses are counted separately, so five at once use up five tries.
     * A right guess does not use the code up: see `use`.
     */
    check(email: string, purpose: CodePurpose, codeHash: string, now: Date, maxAttempts: number): Promise<CodeCheck>

    /**
     * Use up the code with this hash, if it is still the live one and unused.
     * Matching the hash, not only the row, matters: a newer code may have
     * replaced the row since `check`, and the old one must not use it up.
     *
     * @returns false when another request used it first, or it was replaced
     */
    use(email: string, purpose: CodePurpose, codeHash: string, now: Date): Promise<boolean>

    /** Remove codes that expired or were used before `before`. */
    deleteStale(before: Date): Promise<number>
}

export const VERIFICATION_CODE_REPOSITORY = Symbol('VerificationCodeRepositoryPort')
