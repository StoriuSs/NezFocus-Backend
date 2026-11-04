export type CodePurpose = 'email-verify' | 'password-reset' | 'password-set' | 'account-delete'

/** How a code email is worded, beyond its purpose. */
export interface CodeEmailWording {
    /** A reset code for an account with no password yet (made with Google): "choose a password", not "reset". */
    firstPassword?: boolean
    /** The account's display name, for "Hello, <name>." Absent: "Hello." */
    name?: string
}

/** ok: the code was right, and is now used up. */
export type CodeCheck = 'ok' | 'invalid' | 'expired'

/**
 * Verification Code Repository Port — one live code per user and purpose.
 */
export interface VerificationCodeRepositoryPort {
    /** Store a new code, replacing any earlier one for the same purpose. */
    replace(userId: string, purpose: CodePurpose, codeHash: string, expiresAt: Date): Promise<void>

    /**
     * Check a code, counting the attempt. Concurrent attempts are counted
     * separately, so five guesses at once use up five attempts.
     *
     * @returns 'expired' once past its time or its attempts, whether or not
     *   this guess was right
     */
    consume(userId: string, purpose: CodePurpose, codeHash: string, now: Date, maxAttempts: number): Promise<CodeCheck>

    /** Remove codes that expired or were used before `before`. */
    deleteStale(before: Date): Promise<number>
}

export const VERIFICATION_CODE_REPOSITORY = Symbol('VerificationCodeRepositoryPort')
