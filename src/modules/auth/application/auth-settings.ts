/** The auth module's tunables, read once from config (src/config/auth.config.ts). */
export interface AuthSettings {
    /** Access-token lifetime. Short: it cannot be recalled once issued, only its session. */
    accessTokenTtlSeconds: number
    /** A session's absolute lifetime. Refreshing does not extend it. */
    sessionTtlDays: number
    /** How long an emailed code works. */
    codeTtlMinutes: number
    /** Wrong guesses before a code is dead. */
    codeMaxAttempts: number
    /**
     * How long after a refresh token is used that presenting it again still
     * counts as the same client racing itself (two tabs), not as theft.
     */
    refreshGraceMs: number
}

export const AUTH_SETTINGS = Symbol('AuthSettings')
