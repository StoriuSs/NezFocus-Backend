import { Inject } from '@nestjs/common'
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { Permission, PERMISSION_CHECKER, PermissionCheckerPort, serverPermissions } from '@/modules/permissions'
import {
    MEMBER_REPOSITORY,
    MemberListItem,
    MemberRepositoryPort,
    ROLE_REPOSITORY,
    RoleListItem,
    RoleRepositoryPort,
    ServerNotFoundError,
    timeoutForViewer
} from '../../../domain'
import { requireServerPermission } from '../../services/require-permission'
import { ListMembersQuery, ListRolesQuery } from './role.queries'

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

@QueryHandler(ListMembersQuery)
export class ListMembersHandler implements IQueryHandler<ListMembersQuery> {
    constructor(
        @Inject(MEMBER_REPOSITORY) private readonly members: MemberRepositoryPort,
        @Inject(PERMISSION_CHECKER) private readonly checker: PermissionCheckerPort
    ) {}

    /**
     * Anyone in the server (D-152); anyone else learns only "not found". A
     * running timeout shows to all, its reason to those who may time people
     * out and to the one timed out (D-154).
     */
    async execute({ userId, serverId, search }: ListMembersQuery): Promise<{ items: MemberListItem[]; total: number }> {
        const access = await this.checker.access(serverId, userId)
        if (!access) throw new ServerNotFoundError(serverId)
        const now = new Date()
        const mayModerate = (serverPermissions(access.server, access.member, now) & Permission.MODERATE_MEMBERS) !== 0n
        const { items, total } = await this.members.search(serverId, search)
        return { items: items.map((item) => timeoutForViewer(item, { userId, mayModerate }, now)), total }
    }
}

export const ROLE_QUERY_HANDLERS = [ListRolesHandler, ListMembersHandler]
