import { Inject } from '@nestjs/common'
import { CommandHandler, ICommandHandler, IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { PERMISSION_CACHE, PERMISSION_CHECKER, PermissionCachePort, PermissionCheckerPort } from '@/modules/permissions'
import {
    planCreateRole,
    planDeleteRole,
    planGrantRole,
    planReorderRoles,
    planRevokeRole,
    planUpdateRole,
    RoleState,
    RoleWrite,
    ServerNotFoundError
} from '../../domain'
import {
    MEMBER_DIRECTORY,
    MemberDirectoryPort,
    MemberListItem,
    ROLE_REPOSITORY,
    RoleListItem,
    RoleRepositoryPort
} from '../ports'
import { requireServerPermission } from '../require-permission'
import {
    CreateRoleCommand,
    DeleteRoleCommand,
    GrantRoleCommand,
    ListMembersQuery,
    ListRolesQuery,
    ReorderRolesCommand,
    RevokeRoleCommand,
    UpdateRoleCommand
} from './role.messages'

/**
 * What every change to the roles does around its own rule: run it in the
 * locked transaction (RoleRepositoryPort.change), answer NOT_FOUND when the
 * server is gone or they are not in it, and tell the permission cache after
 * the commit what changed (D-146): the server's block when a role itself
 * changed, the member's when they gained or lost one.
 */
abstract class ChangeRoles {
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

@QueryHandler(ListRolesQuery)
export class ListRolesHandler implements IQueryHandler<ListRolesQuery> {
    constructor(
        @Inject(ROLE_REPOSITORY) private readonly roles: RoleRepositoryPort,
        @Inject(PERMISSION_CHECKER) private readonly checker: PermissionCheckerPort
    ) {}

    async execute({ userId, serverId }: ListRolesQuery): Promise<RoleListItem[]> {
        await requireServerPermission(this.checker, serverId, userId, 'MANAGE_ROLES')
        return this.roles.list(serverId)
    }
}

@CommandHandler(CreateRoleCommand)
export class CreateRoleHandler extends ChangeRoles implements ICommandHandler<CreateRoleCommand> {
    async execute({ userId, serverId, name }: CreateRoleCommand): Promise<{ roleId: string }> {
        const { createdId } = await this.change(serverId, userId, [], (s, now) => planCreateRole(s, name, now))
        return { roleId: createdId! }
    }
}

@CommandHandler(UpdateRoleCommand)
export class UpdateRoleHandler extends ChangeRoles implements ICommandHandler<UpdateRoleCommand> {
    async execute({ userId, serverId, roleId, edit }: UpdateRoleCommand): Promise<void> {
        await this.change(serverId, userId, [], (s, now) => planUpdateRole(s, roleId, edit, now))
    }
}

@CommandHandler(DeleteRoleCommand)
export class DeleteRoleHandler extends ChangeRoles implements ICommandHandler<DeleteRoleCommand> {
    async execute({ userId, serverId, roleId }: DeleteRoleCommand): Promise<void> {
        await this.change(serverId, userId, [], (s, now) => planDeleteRole(s, roleId, now))
    }
}

@CommandHandler(ReorderRolesCommand)
export class ReorderRolesHandler extends ChangeRoles implements ICommandHandler<ReorderRolesCommand> {
    async execute({ userId, serverId, seen, wanted }: ReorderRolesCommand): Promise<void> {
        await this.change(serverId, userId, [], (s, now) => planReorderRoles(s, seen, wanted, now))
    }
}

@CommandHandler(GrantRoleCommand)
export class GrantRoleHandler extends ChangeRoles implements ICommandHandler<GrantRoleCommand> {
    async execute({ userId, serverId, roleId, userIds }: GrantRoleCommand): Promise<void> {
        await this.change(serverId, userId, userIds, (s, now) => planGrantRole(s, roleId, userIds, now))
    }
}

@CommandHandler(RevokeRoleCommand)
export class RevokeRoleHandler extends ChangeRoles implements ICommandHandler<RevokeRoleCommand> {
    async execute({ userId, serverId, roleId, targetId }: RevokeRoleCommand): Promise<void> {
        await this.change(serverId, userId, [targetId], (s, now) => planRevokeRole(s, roleId, targetId, now))
    }
}

@QueryHandler(ListMembersQuery)
export class ListMembersHandler implements IQueryHandler<ListMembersQuery> {
    constructor(
        @Inject(MEMBER_DIRECTORY) private readonly members: MemberDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly checker: PermissionCheckerPort
    ) {}

    /** Anyone in the server (D-152); anyone else learns only "not found". */
    async execute({ userId, serverId, search }: ListMembersQuery): Promise<{ items: MemberListItem[]; total: number }> {
        if (!(await this.checker.access(serverId, userId))) throw new ServerNotFoundError(serverId)
        return this.members.search(serverId, search)
    }
}

export const ROLE_HANDLERS = [
    ListRolesHandler,
    CreateRoleHandler,
    UpdateRoleHandler,
    DeleteRoleHandler,
    ReorderRolesHandler,
    GrantRoleHandler,
    RevokeRoleHandler,
    ListMembersHandler
]
