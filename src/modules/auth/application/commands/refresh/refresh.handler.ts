import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Inject, Logger } from '@nestjs/common'
import { RefreshCommand } from './refresh.command'
import { RefreshFailedError, SESSION_REPOSITORY, SessionRepositoryPort, sessionEndReason } from '@/modules/auth/domain'
import { AUTH_SETTINGS, AuthSettings } from '../../auth-settings'
import {
    AUTH_EVENTS,
    AuthEventsPort,
    SESSION_CACHE,
    SessionCachePort,
    TOKEN_SERVICE,
    TokenServicePort
} from '../../ports'
import { IssuedSession } from '../../services/session-issuer'

/**
 * Trade a refresh token for a new access token — and a new refresh token:
 * every one is used once.
 *
 * A refresh token presented a second time was copied. Whoever holds it now,
 * the session is ended: the legitimate client signs in again, and the copy is
 * worthless. The exception is the same client racing itself — two tabs whose
 * access tokens expired together both refresh with the one cookie. Within a
 * few seconds of the first use, the second gets the same new token instead.
 */
@CommandHandler(RefreshCommand)
export class RefreshHandler implements ICommandHandler<RefreshCommand> {
    private readonly logger = new Logger(RefreshHandler.name)

    constructor(
        @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort,
        @Inject(TOKEN_SERVICE) private readonly tokens: TokenServicePort,
        @Inject(SESSION_CACHE) private readonly cache: SessionCachePort,
        @Inject(AUTH_EVENTS) private readonly events: AuthEventsPort,
        @Inject(AUTH_SETTINGS) private readonly settings: AuthSettings
    ) {}

    async execute(command: RefreshCommand): Promise<IssuedSession> {
        if (!command.refreshToken) throw new RefreshFailedError()

        const tokenHash = this.tokens.hashRefreshToken(command.refreshToken)
        const next = this.tokens.newRefreshToken()
        const outcome = await this.sessions.rotate({
            tokenHash,
            newTokenHash: next.hash,
            now: new Date(),
            graceMs: this.settings.refreshGraceMs,
            beforeCommit: async () => {
                try {
                    await this.cache.rememberReplacement(tokenHash, next.token, this.settings.refreshGraceMs)
                } catch (error) {
                    // Only the racing second tab needs it; it will sign in again.
                    this.logger.warn(`Could not remember a refresh token's replacement: ${(error as Error).message}`)
                }
            }
        })

        switch (outcome.kind) {
            case 'rotated':
                return this.issue(outcome.session, next.token)

            case 'grace': {
                const replacement = await this.cache.recallReplacement(tokenHash).catch(() => null)
                if (!replacement) throw new RefreshFailedError()
                return this.issue(outcome.session, replacement)
            }

            case 'reused':
                // Counted, and reported with whom it concerns: an incident to follow up.
                this.events.record('refresh_reuse_detected', {
                    userId: outcome.session.userId,
                    sessionId: outcome.session.id
                })
                await this.cache.invalidateSessions([outcome.session.id])
                this.logger.warn(
                    `A refresh token was used twice; session ${outcome.session.id} of user ${outcome.session.userId} has been ended`
                )
                throw new RefreshFailedError('security')

            case 'invalid':
                throw new RefreshFailedError(outcome.ended ? sessionEndReason(outcome.ended) : undefined)
        }
    }

    private async issue(session: { id: string; userId: string; expiresAt: Date }, refreshToken: string) {
        const access = await this.tokens.issueAccessToken({ userId: session.userId, sessionId: session.id })
        return {
            accessToken: access.token,
            expiresInSeconds: access.expiresInSeconds,
            refreshToken,
            refreshExpiresAt: session.expiresAt
        }
    }
}
