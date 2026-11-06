/** What an access token vouches for. */
export interface AccessTokenClaims {
    userId: string
    sessionId: string
}

export interface IssuedAccessToken {
    token: string
    expiresInSeconds: number
}

export interface NewRefreshToken {
    /** Sent to the browser once, in the cookie. Never stored. */
    token: string
    /** What is stored, and looked up. */
    hash: string
}

/**
 * Token Service Port — access tokens this API signs and verifies itself, and
 * the opaque refresh tokens behind the cookie.
 */
export interface TokenServicePort {
    issueAccessToken(claims: AccessTokenClaims): Promise<IssuedAccessToken>

    /**
     * @throws TokenExpiredError for an expired token, TokenInvalidError for
     *   anything else wrong with it
     */
    verifyAccessToken(token: string): Promise<AccessTokenClaims>

    newRefreshToken(): NewRefreshToken

    hashRefreshToken(token: string): string

    /**
     * What a verification code is stored as. Keyed with the server's secret:
     * a code is only six digits, so a plain hash could be reversed by trying
     * all million, and a database read alone would hand over live codes. Bound
     * to the address and purpose, so a code for one address cannot pass for
     * another's, and a sign-in code cannot pass for a reset code.
     */
    hashVerificationCode(code: string, email: string, purpose: string): string
}

export const TOKEN_SERVICE = Symbol('TokenServicePort')
