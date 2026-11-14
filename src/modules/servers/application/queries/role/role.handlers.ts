import { Inject } from '@nestjs/common'
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { Permission, PERMISSION_CHECKER, PermissionCheckerPort, serverPermissions } from '@/modules/permissions'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import {
    MEMBER_REPOSITORY,
    MemberListItem,
    MemberRepositoryPort,
    NotOwnerError,
    ROLE_REPOSITORY,
    RoleListItem,
    RoleRepositoryPort,
    ServerNotFoundError,
    timeoutForViewer
} from '../../../domain'
import { requireServerPermission } from '../../services/require-permission'
import { ListMembersQuery, ListMentionableRolesQuery, ListRolesQuery } from './role.queries'

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

/** A role as the composer suggests it: "{N} members" under its name (C-12 MentionSuggest). */
export type MentionableRole = Pick<RoleListItem, 'id' | 'name' | 'memberCount'>

/**
 * Anyone in the server (D-171); anyone else learns only "not found". The
 * roles they may mention, highest first: those that let everyone mention
 * them, or every one with MENTION_EVERYONE (REQ-MSG-03). Never @everyone's
 * own role: the @everyone mention stands for it.
 */
@QueryHandler(ListMentionableRolesQuery)
export class ListMentionableRolesHandler implements IQueryHandler<ListMentionableRolesQuery> {
    constructor(
        @Inject(ROLE_REPOSITORY) private readonly roles: RoleRepositoryPort,
        @Inject(PERMISSION_CHECKER) private readonly checker: PermissionCheckerPort
    ) {}

    async execute({ userId, serverId }: ListMentionableRolesQuery): Promise<MentionableRole[]> {
        const access = await this.checker.access(serverId, userId)
        if (!access) throw new ServerNotFoundError(serverId)
        const mayMentionAll =
            (serverPermissions(access.server, access.member, new Date()) & Permission.MENTION_EVERYONE) !== 0n
        const roles = await this.roles.list(serverId)
        return roles
            .filter((role) => !role.isEveryone && (role.mentionable || mayMentionAll))
            .map(({ id, name, memberCount }) => ({ id, name, memberCount }))
    }
}

@QueryHandler(ListMembersQuery)
export class ListMembersHandler implements IQueryHandler<ListMembersQuery> {
    constructor(
        @Inject(MEMBER_REPOSITORY) private readonly members: MemberRepositoryPort,
        @Inject(PERMISSION_CHECKER) private readonly checker: PermissionCheckerPort,
        @Inject(USER_DIRECTORY) private readonly directory: UserDirectoryPort
    ) {}

    /**
     * Anyone in the server (D-152); anyone else learns only "not found". A
     * running timeout shows to all, its reason to those who may time people
     * out and to the one timed out (D-154).
     */
    async execute({ userId, serverId, search }: ListMembersQuery): Promise<{ items: MemberListItem[]; total: number }> {
        const access = await this.checker.access(serverId, userId)
        if (!access) throw new ServerNotFoundError(serverId)
        // Who is waiting to be deleted is no one else's business (D-161).
        if (search.transferableFrom !== null && access.server.ownerId !== userId) throw new NotOwnerError()
        const now = new Date()
        const mayModerate = (serverPermissions(access.server, access.member, now) & Permission.MODERATE_MEMBERS) !== 0n
        const { items, total } = await this.members.search(serverId, search)
        // The repository gives the stored picture keys; the client needs addresses.
        const shown = await Promise.all(
            items.map(async (item) => ({ ...item, avatarUrl: await this.directory.avatarUrl(item.avatarUrl) }))
        )
        return { items: shown.map((item) => timeoutForViewer(item, { userId, mayModerate }, now)), total }
    }
}

export const ROLE_QUERY_HANDLERS = [ListRolesHandler, ListMentionableRolesHandler, ListMembersHandler]
