import { Inject, Injectable } from '@nestjs/common'
import { createHash, createHmac, randomBytes, randomUUID } from 'crypto'
import { SignJWT, errors, jwtVerify } from 'jose'
import { AUTH_SETTINGS, AuthSettings } from '@/modules/auth/application/auth-settings'
import {
    AccessTokenClaims,
    IssuedAccessToken,
    NewRefreshToken,
    TokenServicePort
} from '@/modules/auth/application/ports'
import { TokenExpiredError, TokenInvalidError } from '@/modules/auth/domain'

/** What signs and names the tokens, from config (src/config/auth.config.ts). */
export interface TokenKeys {
    secret: string
    issuer: string
    audience: string
}

export const TOKEN_KEYS = Symbol('TokenKeys')

/** Marks an access token, so no other token this API signs can pass for one. */
const ACCESS_TYPE = 'access'

/**
 * Access tokens are HS256 JWTs signed with JWT_SECRET: this API is the only
 * thing that verifies them, so a shared secret needs no key distribution and
 * no JWKS endpoint (docs/auth/in-the-code.md, "Signing keys", covers moving
 * to a key pair when a second service must verify them).
 *
 * They carry the user and the session and nothing else — no roles, no email.
 * Those come from the session check on every request, so a change to them
 * takes effect at once rather than when the token expires.
 */
@Injectable()
export class JoseTokenService implements TokenServicePort {
    private readonly key: Uint8Array

    constructor(
        @Inject(TOKEN_KEYS) private readonly keys: TokenKeys,
        @Inject(AUTH_SETTINGS) private readonly settings: AuthSettings
    ) {
        this.key = new TextEncoder().encode(keys.secret)
    }

    async issueAccessToken({ userId, sessionId }: AccessTokenClaims): Promise<IssuedAccessToken> {
        const ttl = this.settings.accessTokenTtlSeconds
        const token = await new SignJWT({ sid: sessionId, typ: ACCESS_TYPE })
            .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
            .setSubject(userId)
            .setIssuer(this.keys.issuer)
            .setAudience(this.keys.audience)
            .setJti(randomUUID())
            .setIssuedAt()
            .setExpirationTime(`${ttl}s`)
            .sign(this.key)
        return { token, expiresInSeconds: ttl }
    }

    async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
        let payload
        try {
            ;({ payload } = await jwtVerify(token, this.key, {
                algorithms: ['HS256'],
                issuer: this.keys.issuer,
                audience: this.keys.audience
            }))
        } catch (error) {
            if (error instanceof errors.JWTExpired) throw new TokenExpiredError()
            throw new TokenInvalidError()
        }
        if (payload.typ !== ACCESS_TYPE || typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
            throw new TokenInvalidError()
        }
        return { userId: payload.sub, sessionId: payload.sid }
    }

    newRefreshToken(): NewRefreshToken {
        const token = randomBytes(32).toString('base64url')
        return { token, hash: this.hashRefreshToken(token) }
    }

    hashRefreshToken(token: string): string {
        return createHash('sha256').update(token).digest('hex')
    }

    hashVerificationCode(code: string, email: string, purpose: string): string {
        return createHmac('sha256', this.key).update(`${purpose}:${email}:${code}`).digest('hex')
    }
}
