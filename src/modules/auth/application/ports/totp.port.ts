/**
 * TOTP Port — the codes an authenticator app shows (RFC 6238): six digits, a
 * new one every 30 seconds, from a secret the app and the API share.
 */
export interface TotpPort {
    /** A new random secret, in the base32 form authenticator apps take. */
    newSecret(): string

    /**
     * The `otpauth://` address an authenticator app reads from a QR code.
     * @param account shown in the app under the issuer: the user's address
     */
    uri(secret: string, account: string, issuer: string): string

    /**
     * Which 30-second step the code belongs to, if it is right for now (give
     * or take one step, for a phone clock a little off); null if it is not.
     * The caller remembers the step, so a code cannot be used twice.
     */
    match(secret: string, code: string, now: Date): number | null
}

export const TOTP = Symbol('TotpPort')
