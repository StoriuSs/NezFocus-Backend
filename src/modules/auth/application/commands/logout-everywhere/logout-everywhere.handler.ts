import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Inject } from '@nestjs/common'
import { LogoutEverywhereCommand } from './logout-everywhere.command'
import { SESSION_CACHE, SessionCachePort } from '../../ports'
import { SESSION_REPOSITORY, SessionRepositoryPort } from '@/modules/auth/domain'

/** End every session the user has, this one included. */
@CommandHandler(LogoutEverywhereCommand)
export class LogoutEverywhereHandler implements ICommandHandler<LogoutEverywhereCommand> {
    constructor(
        @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort,
        @Inject(SESSION_CACHE) private readonly cache: SessionCachePort
    ) {}

    async execute(command: LogoutEverywhereCommand): Promise<void> {
        const ended = await this.sessions.revokeAllForUser(command.userId, 'logout-all', new Date())
        await this.cache.invalidateSessions(ended)
    }
}
