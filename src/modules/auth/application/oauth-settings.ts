/** Sign-in with other providers: what the commands need from config. */
export interface OAuthSettings {
    /**
     * The API's public address of the auth routes, `https://api.example.com/api/v1/auth`.
     * A provider's return address is `<this>/<provider>/callback`, and must be
     * registered with the provider exactly so.
     */
    callbackBaseUrl: string
    /** How long someone may spend at the provider before the attempt is forgotten. */
    attemptTtlSeconds: number
}

export const OAUTH_SETTINGS = Symbol('OAuthSettings')

export const oauthRedirectUri = (settings: OAuthSettings, provider: string) =>
    `${settings.callbackBaseUrl}/${provider}/callback`
