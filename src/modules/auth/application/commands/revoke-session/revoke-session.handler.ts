import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Inject } from '@nestjs/common'
import { RevokeSessionCommand } from './revoke-session.command'
import { SESSION_CACHE, SessionCachePort } from '../../ports'
import { SESSION_REPOSITORY, SessionRepositoryPort } from '@/modules/auth/domain'

/**
 * Sign out one session from the list of sessions (D-75): no confirmation, and
 * the device finds out at its next request, told only that its session ended
 * (`revoked`, D-65).
 *
 * The same answer for a session that already ended (it may have expired a
 * moment ago), one that is not this user's and one that does not exist: the
 * row disappears either way, and nothing tells one user about another's
 * sessions (NFR-SEC-05).
 */
@CommandHandler(RevokeSessionCommand)
export class RevokeSessionHandler implements ICommandHandler<RevokeSessionCommand> {
    constructor(
        @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort,
        @Inject(SESSION_CACHE) private readonly cache: SessionCachePort
    ) {}

    async execute({ userId, sessionId }: RevokeSessionCommand): Promise<void> {
        const theirs = await this.sessions.revokeOne(userId, sessionId, 'revoked', new Date())
        // On the main path: the cached session is what the next request is checked against.
        if (theirs) await this.cache.invalidateSessions([sessionId])
    }
}
