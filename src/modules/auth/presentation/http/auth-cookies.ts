import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Request, Response } from 'express'
import { ServiceResponse, createResponse } from '@/shared/types'
import { validateAndTransform } from '@/shared/utils'
import type { CookieSameSite } from '@/config/auth.config'
import { OriginNotAllowedError } from '@/modules/auth/domain'
import { IssuedSession } from '@/modules/auth/application'
import { TokenResponseDto } from './dto'

interface CookieSettings {
    name: string
    sameSite: CookieSameSite
    secure: boolean
}

/** Holds the state of a sign-in with another provider while the browser is away. */
const OAUTH_STATE_COOKIE = 'oauth_state'
/** Matches OAuthSettings.attemptTtlSeconds: the attempt is forgotten then too. */
const OAUTH_STATE_TTL_MS = 10 * 60_000

/**
 * The cookies of the auth routes, for every controller here: each is set by
 * one route and read or cleared by another, often in another controller (the
 * Google return sets the refresh cookie that `refresh` reads).
 *
 * - The refresh token: httpOnly, scoped to `/api/v1/auth`, so the page's
 *   JavaScript can never read it and the browser sends it nowhere else.
 * - `oauth_state`: ties the provider's return to the browser that left.
 *
 * And the Origin check that guards the routes authenticated by a cookie.
 */
@Injectable()
export class AuthCookies {
    private readonly refresh: CookieSettings
    private readonly path: string
    private readonly allowedOrigins: Set<string>

    constructor(config: ConfigService) {
        this.refresh = config.get<CookieSettings>('auth.cookie')!
        this.path = `/${config.get<string>('app.apiPrefix')!.replace(/^\/+|\/+$/g, '')}/v1/auth`
        this.allowedOrigins = new Set(config.get<string[]>('cors.origins') ?? [])
    }

    /** Sets the refresh cookie and answers with the access token: how every route that signs in ends. */
    signedIn(res: Response, session: IssuedSession, message: string): ServiceResponse<TokenResponseDto> {
        this.setRefresh(res, session)
        const body = validateAndTransform(TokenResponseDto, {
            accessToken: session.accessToken,
            tokenType: 'Bearer',
            expiresIn: session.expiresInSeconds
        })
        return createResponse(message, body)
    }

    setRefresh(res: Response, session: IssuedSession): void {
        res.cookie(this.refresh.name, session.refreshToken, {
            ...this.refreshOptions(),
            expires: session.refreshExpiresAt
        })
    }

    clearRefresh(res: Response): void {
        res.clearCookie(this.refresh.name, this.refreshOptions())
    }

    readRefresh(req: Request): string | undefined {
        const value = cookieOf(req, this.refresh.name)
        return typeof value === 'string' && value.length > 0 ? value : undefined
    }

    setOAuthState(res: Response, provider: string, state: string): void {
        res.cookie(OAUTH_STATE_COOKIE, state, { ...this.oauthStateOptions(provider), maxAge: OAUTH_STATE_TTL_MS })
    }

    readOAuthState(req: Request): string | undefined {
        const value = cookieOf(req, OAUTH_STATE_COOKIE)
        return typeof value === 'string' ? value : undefined
    }

    clearOAuthState(res: Response, provider: string): void {
        res.clearCookie(OAUTH_STATE_COOKIE, this.oauthStateOptions(provider))
    }

    /**
     * The cookie-authenticated routes (refresh, logout) also check where the request came from. SameSite already
     * stops another site sending the cookie; this is the second lock, and the
     * one that holds with SameSite=None. A request with no Origin (a
     * non-browser client) is allowed: it cannot be a page on another site
     * acting with the user's cookie.
     */
    assertAllowedOrigin(req: Request): void {
        const origin = req.get('origin')
        if (origin && !this.allowedOrigins.has(origin)) throw new OriginNotAllowedError()
    }

    private refreshOptions() {
        return { httpOnly: true, secure: this.refresh.secure, sameSite: this.refresh.sameSite, path: this.path }
    }

    private oauthStateOptions(provider: string) {
        return {
            httpOnly: true,
            secure: this.refresh.secure,
            sameSite: this.navigationSameSite(),
            path: `${this.path}/${encodeURIComponent(provider)}/callback`
        }
    }

    /**
     * Lax even when the refresh cookie is Strict, for the cookie of a sign-in
     * with Google: the return is a navigation from the provider's site, and a
     * Strict cookie would not come back with it.
     */
    private navigationSameSite(): 'none' | 'lax' {
        return this.refresh.sameSite === 'none' ? 'none' : 'lax'
    }
}

const cookieOf = (req: Request, name: string): unknown => (req.cookies as Record<string, unknown> | undefined)?.[name]
