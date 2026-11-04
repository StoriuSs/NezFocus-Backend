/**
 * Password Hasher Port — slow, salted, one-way.
 */
export interface PasswordHasherPort {
    hash(password: string): Promise<string>

    verify(hash: string, password: string): Promise<boolean>

    /**
     * Spend the same time as `verify`, for an account that does not exist.
     * Without it, how long a sign-in takes would tell an attacker which
     * addresses are registered.
     */
    verifyDummy(password: string): Promise<void>

    /** Whether the hash was made with weaker parameters than the current ones. */
    needsRehash(hash: string): boolean
}

export const PASSWORD_HASHER = Symbol('PasswordHasherPort')
