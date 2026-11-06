/**
 * What the access-token guard attaches to `request.user`, read with
 * `@CurrentUser()`. Fresh on every request: it comes from the session check,
 * not from claims inside the token, so a changed role or a deleted account
 * takes effect at once.
 */
export interface AuthenticatedUser {
    /** The user's id — the `sub` claim of the access token. */
    id: string
    /** The session this request came in — the token's `sid` claim. */
    sessionId: string
    /** Null only for an account whose personal data has been erased. */
    email: string | null
    roles: string[]
    username: string | null
    displayName: string | null
    /** The stored key, not a URL: the users module turns it into one. */
    avatarUrl: string | null
    bio: string | null
    /** Whether the "complete your account" step is done (D-61). */
    completed: boolean
}
