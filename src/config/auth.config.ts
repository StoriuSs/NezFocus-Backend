import { registerAs } from '@nestjs/config'
import { parseBooleanEnv, parseIntSafe } from '@/shared/utils'

export type CookieSameSite = 'lax' | 'strict' | 'none'

/**
 * Authentication settings. Every one is validated in validation.ts; see
 * docs/environment.md, "Authentication".
 */
export default registerAs('auth', () => {
    const production = process.env.NODE_ENV === 'production'
    const baseUrl = (process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '')
    const sameSite = (process.env.AUTH_COOKIE_SAMESITE || 'lax').toLowerCase() as CookieSameSite
    const apiPrefix = (process.env.API_PREFIX || 'api').replace(/^\/+|\/+$/g, '')

    return {
        // Signs access tokens, and keys the stored hashes of emailed codes.
        jwtSecret: process.env.JWT_SECRET ?? '',
        // Access tokens name the API that issued them and the API they are for:
        // both are this one.
        issuer: baseUrl,
        audience: baseUrl,
        accessTokenTtlSeconds: parseIntSafe(process.env.JWT_ACCESS_TTL_SECONDS, 900),
        sessionTtlDays: parseIntSafe(process.env.AUTH_SESSION_TTL_DAYS, 30),
        cookie: {
            name: 'refresh_token',
            sameSite,
            // Secure by default in production. SameSite=None requires it.
            secure:
                process.env.AUTH_COOKIE_SECURE !== undefined && process.env.AUTH_COOKIE_SECURE !== ''
                    ? parseBooleanEnv(process.env.AUTH_COOKIE_SECURE)
                    : production || sameSite === 'none'
        },
        // Sign-in with other providers. A provider's return address is
        // <this>/<provider>/callback, registered with it exactly so.
        oauthCallbackBaseUrl: `${baseUrl}/${apiPrefix}/v1/auth`,
        // Both set: "Continue with Google" is on. Both empty: off.
        google: {
            clientId: process.env.GOOGLE_CLIENT_ID?.trim() ?? '',
            clientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() ?? ''
        }
    }
})
