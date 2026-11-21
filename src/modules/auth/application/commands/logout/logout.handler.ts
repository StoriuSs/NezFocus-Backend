import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import { Inject } from '@nestjs/common'
import { LogoutCommand } from './logout.command'
import { TOKEN_SERVICE, TokenServicePort } from '../../ports'
import { SESSION_REPOSITORY, SessionRepositoryPort } from '@/modules/auth/domain'
import { SessionEnds } from '../../services/session-ends'
import { SignedOutEvent } from '../../events/signed-out.event'

/**
 * End the session the refresh cookie belongs to, then say who signed out
 * (SignedOutEvent: the study module ends their Solo, D-229). Always succeeds:
 * signing out of a session that already ended, or with no cookie at all,
 * leaves the same result — signed out — and says nothing.
 */
@CommandHandler(LogoutCommand)
export class LogoutHandler implements ICommandHandler<LogoutCommand> {
    constructor(
        @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort,
        @Inject(TOKEN_SERVICE) private readonly tokens: TokenServicePort,
        private readonly sessionEnds: SessionEnds,
        private readonly events: EventBus
    ) {}

    async execute(command: LogoutCommand): Promise<void> {
        if (!command.refreshToken) return
        const ended = await this.sessions.revokeByTokenHash(
            this.tokens.hashRefreshToken(command.refreshToken),
            'logout',
            new Date()
        )
        if (!ended) return
        await this.sessionEnds.ended([ended.sessionId])
        this.events.publish(new SignedOutEvent(ended.userId))
    }
}
