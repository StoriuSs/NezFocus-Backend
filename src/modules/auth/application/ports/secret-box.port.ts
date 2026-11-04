/**
 * Secret Box Port — keeping a secret the API must read back (a two-step
 * sign-in secret) unreadable in the database, and fingerprinting one it only
 * needs to recognise (a recovery code). Keyed with AUTH_ENCRYPTION_KEY, so a
 * copy of the database alone reveals neither.
 *
 * The key can be changed without locking anyone out: the old one goes in
 * AUTH_ENCRYPTION_KEY_PREVIOUS, what it sealed is still opened (and sealed
 * again with the new key), and its fingerprints are still recognised.
 */
export interface SecretBoxPort {
    /** Encrypt with the current key: the result is text, safe to store. */
    seal(plaintext: string): string

    /**
     * Decrypt what `seal` made, with whichever configured key sealed it.
     * `resealed` is the same secret sealed with the current key, when an older
     * key opened it: store it, so the older key is needed less and less.
     * @throws SealedWithUnknownKeyError when no configured key sealed it
     */
    open(sealed: string): { plaintext: string; resealed: string | null }

    /** A keyed one-way fingerprint with the current key, to store. */
    fingerprint(value: string): string

    /** The value's fingerprint under every configured key: what a stored one may be. */
    fingerprints(value: string): string[]

    /** Which key sealed or fingerprinted this, if one configured here did. */
    keyOf(sealedOrFingerprint: string): 'current' | 'previous' | null
}

/**
 * A stored secret was sealed with a key this server does not have:
 * AUTH_ENCRYPTION_KEY was changed without putting the old one in
 * AUTH_ENCRYPTION_KEY_PREVIOUS, or lost.
 */
export class SealedWithUnknownKeyError extends Error {
    constructor() {
        super('Sealed with an encryption key this server does not have')
        this.name = 'SealedWithUnknownKeyError'
    }
}

export const SECRET_BOX = Symbol('SecretBoxPort')
