/**
 * Current Password Port — proof that the person signed in is the account's
 * owner, for another module's step that asks for the password again (the
 * servers module, handing a server over, REQ-SRV-05). Wrong passwords count
 * against the account as when changing it or deleting it: 5 in 15 minutes
 * (D-73), so this is no new way to guess one.
 */
export interface CurrentPasswordPort {
    /**
     * Resolves when the password is the account's. Otherwise throws
     * CurrentPasswordInvalidError (400 AUTH_CURRENT_PASSWORD_INVALID), or
     * RateLimitedError (429) once the wrong ones are used up.
     */
    confirm(userId: string, password: string): Promise<void>
}

export const CURRENT_PASSWORD = Symbol('CurrentPasswordPort')
