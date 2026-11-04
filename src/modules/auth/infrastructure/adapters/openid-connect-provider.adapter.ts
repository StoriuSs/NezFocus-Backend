import * as oidc from 'openid-client'
import { OAuthChecks, OAuthIdentity, OAuthProviderPort } from '@/modules/auth/application/ports'

export interface OpenIdConnectSettings {
    /** `google` */
    id: string
    /** `Google` */
    displayName: string
    /** Where its discovery document lives: `https://accounts.google.com`. */
    issuer: string
    clientId: string
    clientSecret: string
    /** Only for tests against a local issuer: plain http. Never in production. */
    allowInsecureRequests?: boolean
    /** Per request to the provider, in seconds. */
    timeoutSeconds?: number
}

/**
 * Any OpenID Connect provider, through `openid-client`: Google, and most
 * others (Microsoft, Apple, GitLab, Okta…) with their own issuer URL.
 *
 * Authorization code flow with PKCE (S256), `state` and `nonce`. The library
 * checks the ID token: signature against the provider's published keys,
 * issuer, audience, expiry, and the nonce. A provider that is not OpenID
 * Connect (GitHub) needs an adapter of its own: docs/auth/google-sign-in.md,
 * "Adding another provider".
 *
 * The discovery document is fetched on the first sign-in, not at boot, so
 * the app starts whether or not the provider can be reached; a failed fetch
 * is a failed sign-in, and the next one tries again.
 */
export class OpenIdConnectProvider implements OAuthProviderPort {
    readonly id: string
    readonly displayName: string
    private configuration: Promise<oidc.Configuration> | null = null

    constructor(private readonly settings: OpenIdConnectSettings) {
        this.id = settings.id
        this.displayName = settings.displayName
    }

    async start(redirectUri: string): Promise<{ authorizationUrl: string; checks: OAuthChecks }> {
        const config = await this.config()
        const checks: OAuthChecks = {
            state: oidc.randomState(),
            nonce: oidc.randomNonce(),
            codeVerifier: oidc.randomPKCECodeVerifier()
        }
        const url = oidc.buildAuthorizationUrl(config, {
            redirect_uri: redirectUri,
            scope: 'openid email profile',
            code_challenge: await oidc.calculatePKCECodeChallenge(checks.codeVerifier),
            code_challenge_method: 'S256',
            state: checks.state,
            nonce: checks.nonce,
            // Let the person choose which account, rather than silently using
            // the one their browser is signed in to.
            prompt: 'select_account'
        })
        return { authorizationUrl: url.href, checks }
    }

    async finish(callbackUrl: URL, redirectUri: string, checks: OAuthChecks): Promise<OAuthIdentity> {
        if (callbackUrl.origin + callbackUrl.pathname !== redirectUri) {
            // The library sends the callback URL, minus its query, as
            // redirect_uri. It must be the registered one.
            throw new Error('the callback URL is not the registered redirect URI')
        }
        const config = await this.config()
        const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
            pkceCodeVerifier: checks.codeVerifier,
            expectedState: checks.state,
            expectedNonce: checks.nonce,
            idTokenExpected: true
        })
        const claims = tokens.claims()
        if (!claims) throw new Error('the provider returned no ID token')
        return {
            subject: claims.sub,
            email: typeof claims.email === 'string' ? claims.email : null,
            // Some providers send "true" as a string.
            emailVerified: claims.email_verified === true || claims.email_verified === 'true',
            name: typeof claims.name === 'string' ? claims.name : null
        }
    }

    private config(): Promise<oidc.Configuration> {
        this.configuration ??= oidc
            .discovery(new URL(this.settings.issuer), this.settings.clientId, this.settings.clientSecret, undefined, {
                timeout: this.settings.timeoutSeconds ?? 10,
                execute: [
                    // Verify the ID token's signature too. By default the
                    // library trusts an ID token from the token endpoint on
                    // the strength of TLS alone, which OpenID Connect
                    // allows; checking the signature against the
                    // provider's published keys costs one cached fetch.
                    oidc.enableNonRepudiationChecks,
                    ...(this.settings.allowInsecureRequests ? [oidc.allowInsecureRequests] : [])
                ]
            })
            .then((configuration) => {
                configuration.timeout = this.settings.timeoutSeconds ?? 10
                return configuration
            })
            .catch((error: unknown) => {
                // Not cached: the next sign-in asks again.
                this.configuration = null
                throw error
            })
        return this.configuration
    }
}
