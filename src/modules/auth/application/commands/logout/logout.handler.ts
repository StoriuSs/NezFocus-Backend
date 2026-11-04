import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Inject } from '@nestjs/common'
import { LogoutCommand } from './logout.command'
import { SESSION_CACHE, SessionCachePort, TOKEN_SERVICE, TokenServicePort } from '../../ports'
import { SESSION_REPOSITORY, SessionRepositoryPort } from '@/modules/auth/domain'

/**
 * End the session the refresh cookie belongs to. Always succeeds: signing out
 * of a session that already ended, or with no cookie at all, leaves the same
 * result — signed out.
 */
@CommandHandler(LogoutCommand)
export class LogoutHandler implements ICommandHandler<LogoutCommand> {
    constructor(
        @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort,
        @Inject(TOKEN_SERVICE) private readonly tokens: TokenServicePort,
        @Inject(SESSION_CACHE) private readonly cache: SessionCachePort
    ) {}

    async execute(command: LogoutCommand): Promise<void> {
        if (!command.refreshToken) return
        const sessionId = await this.sessions.revokeByTokenHash(
            this.tokens.hashRefreshToken(command.refreshToken),
            'logout',
            new Date()
        )
        if (sessionId) await this.cache.invalidateSessions([sessionId])
    }
}
