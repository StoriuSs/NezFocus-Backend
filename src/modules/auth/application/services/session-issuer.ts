import { Inject, Injectable } from '@nestjs/common'
import { AUTH_SETTINGS, AuthSettings } from '../auth-settings'
import { TOKEN_SERVICE, TokenServicePort } from '../ports'
import { SESSION_REPOSITORY, SessionRepositoryPort } from '@/modules/auth/domain'

/** What a sign-in hands back: a token for requests, and one for the cookie. */
export interface IssuedSession {
    accessToken: string
    expiresInSeconds: number
    /** Goes into the httpOnly cookie, and nowhere else. */
    refreshToken: string
    /** When the cookie, and the session, end. */
    refreshExpiresAt: Date
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Starts a session: a row, a refresh token for it, and an access token. */
@Injectable()
export class SessionIssuer {
    constructor(
        @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort,
        @Inject(TOKEN_SERVICE) private readonly tokens: TokenServicePort,
        @Inject(AUTH_SETTINGS) private readonly settings: AuthSettings
    ) {}

    async start(userId: string, client: { userAgent?: string; ip?: string }, now: Date): Promise<IssuedSession> {
        const refresh = this.tokens.newRefreshToken()
        const expiresAt = new Date(now.getTime() + this.settings.sessionTtlDays * DAY_MS)
        const session = await this.sessions.create({
            userId,
            expiresAt,
            refreshTokenHash: refresh.hash,
            // Shown on a future "your sessions" page; bounded so a hostile
            // header cannot fill a row.
            userAgent: client.userAgent?.slice(0, 512),
            ip: client.ip
        })
        const access = await this.tokens.issueAccessToken({ userId, sessionId: session.id })
        return {
            accessToken: access.token,
            expiresInSeconds: access.expiresInSeconds,
            refreshToken: refresh.token,
            refreshExpiresAt: expiresAt
        }
    }
}
