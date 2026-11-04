/**
 * OAuth Provider Port — signing in with another service (Google).
 *
 * One adapter per provider, all behind this interface, so adding one is a
 * file rather than a change to the sign-in logic. The commands never see a
 * token from the provider: an adapter turns the provider's answer into an
 * OAuthIdentity and nothing more.
 */

/** Who the provider says the person is. */
export interface OAuthIdentity {
    /** The provider's id for the person (`sub`): stable, unlike the address. */
    subject: string
    email: string | null
    /** Whether the provider checked the person reads that address. */
    emailVerified: boolean
    name: string | null
}

/**
 * The values one sign-in attempt must match on its way back: kept on the
 * server between the redirect to the provider and the return from it.
 */
export interface OAuthChecks {
    /** Ties the return to this attempt (and, through a cookie, to this browser). */
    state: string
    /** Ties the ID token to this attempt: a token issued for another is refused. */
    nonce: string
    /** PKCE: proves the code is redeemed by whoever asked for it. */
    codeVerifier: string
}

export interface OAuthProviderPort {
    /** The name in the URL and in the stored link: `google`. */
    readonly id: string
    /** The name people know it by, for emails: `Google`. */
    readonly displayName: string

    /** Where to send the browser, and the checks to keep until it returns. */
    start(redirectUri: string): Promise<{ authorizationUrl: string; checks: OAuthChecks }>

    /**
     * Redeem the code in the provider's return. Rejects if anything does not
     * match: the state, the nonce, the PKCE verifier, the ID token's signature,
     * issuer, audience or age.
     *
     * @param callbackUrl the return as the provider sent it (its query holds the code)
     * @param redirectUri the same one `start` was given
     */
    finish(callbackUrl: URL, redirectUri: string, checks: OAuthChecks): Promise<OAuthIdentity>
}

/** The providers that are configured, in the order they are offered. */
export const OAUTH_PROVIDERS = Symbol('OAuthProviders')
