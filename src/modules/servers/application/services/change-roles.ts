import { Inject } from '@nestjs/common'
import { EventBus } from '@nestjs/cqrs'
import { PERMISSION_CACHE, PermissionCachePort } from '@/modules/permissions'
import { ROLE_REPOSITORY, RoleRepositoryPort, RoleState, RoleWrite, ServerNotFoundError } from '../../domain'
import { MemberChangedEvent } from '../events/member-changed.event'
import { ServerChange, ServerChangedEvent } from '../events/server-changed.event'

type RoleKind = Exclude<RoleWrite['kind'], 'grantRole' | 'revokeRole'>

/**
 * What the members are told of a change to a role itself (D-178), and
 * whether it may change who views a channel: its permissions, or its going.
 * A new role is held by no one yet. A role given or taken is told as that
 * member changing (MemberChangedEvent).
 */
const TOLD: { [K in RoleKind]: (write: Extract<RoleWrite, { kind: K }>) => ServerChange & { view: boolean } } = {
    createRole: () => ({ topic: 'role', action: 'created', view: false }),
    updateRole: (write) => ({ topic: 'role', action: 'updated', view: write.changes.permissions !== undefined }),
    deleteRole: () => ({ topic: 'role', action: 'deleted', view: true }),
    placeRoles: () => ({ topic: 'role', action: 'updated', view: false })
}

/**
 * What every change to the roles does around its own rule: run it in the
 * locked transaction (RoleRepositoryPort.change), answer NOT_FOUND when the
 * server is gone or they are not in it, and tell the permission cache after
 * the commit what changed (D-146): the server's block when a role itself
 * changed, the member's when they gained or lost one. Then the members
 * (D-178).
 */
export abstract class ChangeRoles {
    constructor(
        @Inject(ROLE_REPOSITORY) private readonly roles: RoleRepositoryPort,
        @Inject(PERMISSION_CACHE) private readonly cache: PermissionCachePort,
        private readonly events: EventBus
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
        this.tell(serverId, writes)
        return result
    }

    /** The roles' changes in one event, each kind once (a role deleted, the rest moved up); then each member. */
    private tell(serverId: string, writes: RoleWrite[]): void {
        const changes: ServerChange[] = []
        let viewChanged = false
        const members: string[] = []
        for (const write of writes) {
            if (write.kind === 'grantRole') members.push(...write.userIds)
            else if (write.kind === 'revokeRole') members.push(write.userId)
            else {
                const { view, ...change } = (
                    TOLD[write.kind] as (write: RoleWrite) => ServerChange & { view: boolean }
                )(write)
                viewChanged ||= view
                changes.push(change)
            }
        }
        if (changes.length > 0) this.events.publish(new ServerChangedEvent(serverId, changes, viewChanged))
        for (const member of members) this.events.publish(new MemberChangedEvent(serverId, member, 'updated'))
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
