import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Inject } from '@nestjs/common'
import { RevokeOtherSessionsCommand } from './revoke-other-sessions.command'
import { SESSION_CACHE, SessionCachePort } from '../../ports'
import { SESSION_REPOSITORY, SessionRepositoryPort } from '@/modules/auth/domain'

/**
 * "Sign out the other devices" (D-75): every session of the user ends except
 * the one asking, which the person pressing the button is sitting at. The
 * others are told which button it was (`signed_out_everywhere`).
 *
 * @returns how many sessions ended, for "Signed out 2 other devices"
 */
@CommandHandler(RevokeOtherSessionsCommand)
export class RevokeOtherSessionsHandler implements ICommandHandler<RevokeOtherSessionsCommand> {
    constructor(
        @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort,
        @Inject(SESSION_CACHE) private readonly cache: SessionCachePort
    ) {}

    async execute({ userId, currentSessionId }: RevokeOtherSessionsCommand): Promise<number> {
        const ended = await this.sessions.revokeAllForUser(userId, 'logout-all', new Date(), currentSessionId)
        await this.cache.invalidateSessions(ended)
        return ended.length
    }
}
