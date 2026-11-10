import { Inject } from '@nestjs/common'
import { PERMISSION_CACHE, PermissionCachePort } from '@/modules/permissions'
import { ModerationState, ModerationWrite, ServerNotFoundError } from '../../domain'
import { MODERATION_REPOSITORY, ModerationRepositoryPort } from '../ports'

/**
 * What every kick, ban, unban and timeout does around its own rule: run it in
 * the locked transaction, answer NOT_FOUND when the server is gone or they
 * are not in it, and, after the commit, tell the permission cache that the
 * member left or was timed out (D-146), so it holds from the next request.
 */
export abstract class Moderate {
    constructor(
        @Inject(MODERATION_REPOSITORY) private readonly moderation: ModerationRepositoryPort,
        @Inject(PERMISSION_CACHE) private readonly cache: PermissionCachePort
    ) {}

    protected async change(
        serverId: string,
        userId: string,
        targetId: string,
        decide: (state: ModerationState, now: Date) => ModerationWrite[]
    ): Promise<void> {
        let writes: ModerationWrite[] = []
        const done = await this.moderation.change(serverId, userId, targetId, (state) => {
            // Read once the lock is held, as the roles do.
            writes = decide(state, new Date())
            return writes
        })
        if (!done) throw new ServerNotFoundError(serverId)
        // An unban changes no member: they are not in the server.
        const members = writes.filter((write) => write.kind !== 'unban').map((write) => write.userId)
        await Promise.all(members.map((member) => this.cache.memberChanged(serverId, member)))
    }
}
