import {
    AccessChannel,
    AccessMember,
    AccessRole,
    channelPermissions,
    Permission,
    serverPermissions
} from '@/modules/permissions'

/** A role as the channel list needs it: the private-channel picker lists roles by name. */
export interface RoleSnapshot extends AccessRole {
    name: string
}

export interface CategorySnapshot {
    id: string
    name: string
    position: number
}

export interface ChannelSnapshot extends AccessChannel {
    categoryId: string | null
    name: string
    position: number
    isStudyRoom: boolean
    taskBoardEnabled: boolean
}

/** A server as stored, everything one member's view is made from. */
export interface ServerSnapshot {
    id: string
    name: string
    iconKey: string | null
    ownerId: string
    welcomeChannelId: string | null
    categories: CategorySnapshot[]
    channels: ChannelSnapshot[]
    roles: RoleSnapshot[]
}

export type ChannelView = Omit<ChannelSnapshot, 'viewRoleIds'> & {
    /** In this channel (appendix B, steps 1–6). Never 0: those are left out. */
    permissions: bigint
    /**
     * Who may see it when private, for those who may edit that (MANAGE_CHANNELS
     * in this channel); null for everyone else, who has no use for it.
     */
    viewRoleIds: string[] | null
}

/** A role in the server's list (not @everyone), for the private-channel picker. */
export interface RoleView {
    id: string
    name: string
    position: number
    /** Sees every channel whatever is picked: shown ticked and locked. */
    administrator: boolean
}

/** A server as one member sees it (GET /servers, D-115, D-145). */
export interface ServerView {
    id: string
    name: string
    iconKey: string | null
    isOwner: boolean
    /** In the server as a whole: what menus and settings pages show. */
    permissions: bigint
    /**
     * Their highest role's position: roles at or above it are locked in the
     * settings. Meaningless for the owner, who outranks every role: read
     * `isOwner` first (a number cannot say "above all" in JSON).
     */
    topRolePosition: number
    /** The roles they hold, not @everyone ("your role" in the private-channel picker). */
    roleIds: string[]
    /** Every role but @everyone, highest first. */
    roles: RoleView[]
    /** Only while it lasts. */
    timeoutUntil: Date | null
    /** Null when there is none, or when it is a channel they cannot see. */
    welcomeChannelId: string | null
    categories: CategorySnapshot[]
    channels: ChannelView[]
}

const byPosition = <T extends { position: number; id: string }>(a: T, b: T) =>
    a.position - b.position || a.id.localeCompare(b.id)

/**
 * What one member may see of a server and do in it. A channel they cannot see
 * is left out entirely, not sent with zero permissions (NFR-SEC-05). So is a
 * category none of whose channels they can see — its name alone can tell
 * ("Ban quản trị") — unless they manage channels and need it to drop channels
 * into.
 */
export function memberView(server: ServerSnapshot, member: AccessMember, now: Date): ServerView {
    const access = { ownerId: server.ownerId, roles: server.roles, channels: server.channels }
    const permissions = serverPermissions(access, member, now)

    const channels: ChannelView[] = []
    for (const channel of [...server.channels].sort(byPosition)) {
        const granted = channelPermissions(access, member, channel, now)
        if (granted === 0n) continue
        const { viewRoleIds, ...shown } = channel
        const editsViewers = (granted & Permission.MANAGE_CHANNELS) !== 0n
        channels.push({ ...shown, permissions: granted, viewRoleIds: editsViewers ? [...viewRoleIds] : null })
    }

    const managesChannels = (permissions & Permission.MANAGE_CHANNELS) !== 0n
    const used = new Set(channels.map((channel) => channel.categoryId))
    const categories = [...server.categories]
        .sort(byPosition)
        .filter((category) => managesChannels || used.has(category.id))

    const held = new Set(member.roleIds)
    const topRolePosition = server.roles.reduce(
        (top, role) => (held.has(role.id) ? Math.max(top, role.position) : top),
        0
    )
    const timedOut = member.timeoutUntil !== null && member.timeoutUntil.getTime() > now.getTime()

    return {
        id: server.id,
        name: server.name,
        iconKey: server.iconKey,
        isOwner: member.userId === server.ownerId,
        permissions,
        topRolePosition,
        roleIds: server.roles.filter((role) => held.has(role.id)).map((role) => role.id),
        roles: server.roles
            .filter((role) => !role.isEveryone)
            .sort((a, b) => b.position - a.position || a.id.localeCompare(b.id))
            .map((role) => ({
                id: role.id,
                name: role.name,
                position: role.position,
                administrator: (role.permissions & Permission.ADMINISTRATOR) !== 0n
            })),
        timeoutUntil: timedOut ? member.timeoutUntil : null,
        // Those who choose it (MANAGE_SERVER) get it even when it is a private
        // channel they do not see, so Overview does not say "Send none"; the
        // id alone tells nothing. Everyone else only for a channel they see.
        welcomeChannelId:
            (permissions & Permission.MANAGE_SERVER) !== 0n ||
            channels.some((channel) => channel.id === server.welcomeChannelId)
                ? server.welcomeChannelId
                : null,
        categories,
        channels
    }
}
