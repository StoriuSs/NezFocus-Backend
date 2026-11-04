import { OAuthChecks } from './oauth-provider.port'

/** What one sign-in attempt keeps between leaving for the provider and coming back. */
export interface OAuthAttempt {
    provider: string
    checks: OAuthChecks
    /** The page of the web app to return to: a path, already checked. */
    redirect: string
}

/**
 * OAuth State Port — attempts in progress, keyed by their state. Each can be
 * taken once: a second return with the same state finds nothing.
 */
export interface OAuthStatePort {
    save(attempt: OAuthAttempt, ttlSeconds: number): Promise<void>

    /** The attempt with this state, removed as it is read; null if unknown, used or expired. */
    take(state: string): Promise<OAuthAttempt | null>
}

export const OAUTH_STATE = Symbol('OAuthStatePort')
