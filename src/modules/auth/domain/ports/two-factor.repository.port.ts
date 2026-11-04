/** A user's two-step sign-in, as stored. */
export interface TwoFactorRecord {
    secretSealed: string
    /** False between setting it up and entering the first code. */
    confirmed: boolean
    lastUsedStep: number | null
}

/**
 * Two-Step Repository Port — the authenticator secret, and the recovery codes.
 */
export interface TwoFactorRepositoryPort {
    find(userId: string): Promise<TwoFactorRecord | null>

    /**
     * Store a new, unconfirmed secret, replacing an unconfirmed one.
     * @returns false if two-step sign-in is already on (a confirmed secret stays)
     */
    saveUnconfirmed(userId: string, secretSealed: string): Promise<boolean>

    /** Turn it on. @returns false if there was no unconfirmed secret to confirm */
    confirm(userId: string, now: Date): Promise<boolean>

    /**
     * Record that a code from this 30-second step was used — only if no code
     * from this step or a later one was. Atomic, so two sign-ins racing with
     * the same code cannot both succeed.
     * @returns false if the step was already used
     */
    useStep(userId: string, step: number): Promise<boolean>

    /**
     * Store the secret sealed again (with the current encryption key), if it is
     * still the one read. @returns false if it had changed meanwhile
     */
    replaceSecret(userId: string, from: string, to: string): Promise<boolean>

    /** Turn it off: the secret and every recovery code go. */
    remove(userId: string): Promise<void>

    /** Replace every recovery code with these fingerprints. */
    replaceRecoveryCodes(userId: string, fingerprints: string[]): Promise<void>

    /**
     * Use one recovery code: atomic, so a code works once. `fingerprints` are
     * the code's under each configured encryption key (SecretBoxPort.fingerprints).
     * @returns false if there is no unused code with any of them
     */
    useRecoveryCode(userId: string, fingerprints: string[], now: Date): Promise<boolean>

    countUnusedRecoveryCodes(userId: string): Promise<number>

    /** Remove the two-step data of every deleted account. @returns how many accounts had some */
    deleteForDeletedAccounts(): Promise<number>
}

export const TWO_FACTOR_REPOSITORY = Symbol('TwoFactorRepositoryPort')
