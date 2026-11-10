import { Inject } from '@nestjs/common'
import { PERMISSION_CACHE, PermissionCachePort } from '@/modules/permissions'
import { RoleState, RoleWrite, ServerNotFoundError } from '../../domain'
import { ROLE_REPOSITORY, RoleRepositoryPort } from '../ports'

/**
 * What every change to the roles does around its own rule: run it in the
 * locked transaction (RoleRepositoryPort.change), answer NOT_FOUND when the
 * server is gone or they are not in it, and tell the permission cache after
 * the commit what changed (D-146): the server's block when a role itself
 * changed, the member's when they gained or lost one.
 */
export abstract class ChangeRoles {
    constructor(
        @Inject(ROLE_REPOSITORY) private readonly roles: RoleRepositoryPort,
        @Inject(PERMISSION_CACHE) private readonly cache: PermissionCachePort
    ) {}

    protected async change(
        serverId: string,
        userId: string,
        targetIds: string[],
        decide: (state: RoleState, now: Date) => RoleWrite[]
    ): Promise<{ createdId: string | null }> {
        let writes: RoleWrite[] = []
        const result = await this.roles.change(serverId, userId, targetIds, (state) => {
            // Read once the lock is held: a wait for it must not judge timeouts by an older clock.
            writes = decide(state, new Date())
            return writes
        })
        if (!result) throw new ServerNotFoundError(serverId)
        await this.forget(serverId, writes)
        return result
    }

    private async forget(serverId: string, writes: RoleWrite[]): Promise<void> {
        const members = writes.flatMap((write) =>
            write.kind === 'grantRole' ? write.userIds : write.kind === 'revokeRole' ? [write.userId] : []
        )
        if (writes.some((write) => write.kind !== 'grantRole' && write.kind !== 'revokeRole')) {
            await this.cache.serverChanged(serverId)
        }
        await Promise.all(members.map((member) => this.cache.memberChanged(serverId, member)))
    }
}
