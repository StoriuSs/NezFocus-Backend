import { Inject } from '@nestjs/common'
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import {
    channelPermissions,
    channelViewers,
    ChannelViewers,
    Permission,
    PERMISSION_CHECKER,
    PermissionCheckerPort,
    serverPermissions
} from '@/modules/permissions'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import {
    ChannelNotFoundError,
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
import { MemberPresence, PRESENCE_READER, PresenceReaderPort } from '../../ports'
import { requireServerPermission } from '../../services/require-permission'
import { ListMembersQuery, ListMentionableRolesQuery, ListRolesQuery } from './role.queries'

/** A member as listed: with what others see of them (REQ-AUTH-07). */
export interface ListedMember extends MemberListItem {
    status: MemberPresence
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
        @Inject(USER_DIRECTORY) private readonly directory: UserDirectoryPort,
        @Inject(PRESENCE_READER) private readonly presence: PresenceReaderPort
    ) {}

    /**
     * Anyone in the server (D-152); anyone else learns only "not found". A
     * running timeout shows to all, its reason to those who may time people
     * out and to the one timed out (D-154). Each member comes with what
     * others see of them, and the page may be of those online or offline,
     * or put those online first (D-175). With a channel, only those who view
     * it, for someone who views it (D-192, the task assignee picker).
     */
    async execute({
        userId,
        serverId,
        search,
        channelId
    }: ListMembersQuery): Promise<{ items: ListedMember[]; total: number }> {
        const access = await this.checker.access(serverId, userId)
        if (!access) throw new ServerNotFoundError(serverId)
        // Who is waiting to be deleted is no one else's business (D-161).
        if (search.transferableFrom !== null && access.server.ownerId !== userId) throw new NotOwnerError()
        const now = new Date()
        let viewers: ChannelViewers | null = null
        if (channelId !== null) {
            const channel = access.server.channels.find((one) => one.id === channelId)
            if (!channel || channelPermissions(access.server, access.member, channel, now) === 0n) {
                throw new ChannelNotFoundError(channelId)
            }
            viewers = channelViewers(access.server, channel)
        }
        const mayModerate = (serverPermissions(access.server, access.member, now) & Permission.MODERATE_MEMBERS) !== 0n
        const shown = await this.presence.everyoneShown()
        const { items, total } = await this.members.search(serverId, { ...search, viewers }, [...shown.keys()])
        // The repository gives the stored picture keys; the client needs addresses.
        const pictured = await Promise.all(
            items.map(async (item) => ({ ...item, avatarUrl: await this.directory.avatarUrl(item.avatarUrl) }))
        )
        return {
            items: pictured.map((item) => ({
                ...timeoutForViewer(item, { userId, mayModerate }, now),
                status: shown.get(item.userId) ?? 'offline'
            })),
            total
        }
    }
}

export const ROLE_QUERY_HANDLERS = [ListRolesHandler, ListMentionableRolesHandler, ListMembersHandler]
