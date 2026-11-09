import { ALL_PERMISSIONS, Permission } from './permission-flags'

/*
 * The one place a member's permissions are worked out (REQ-ROLE-05). Pure
 * functions over plain data: the same answer every time for the same input,
 * which is what lets the matrix test cover every rule, and lets the cache keep
 * the inputs rather than the answers (D-146).
 */

export interface AccessRole {
    id: string
    permissions: bigint
    /** Higher is more senior; @everyone is 0. */
    position: number
    isEveryone: boolean
}

export interface AccessChannel {
    id: string
    type: 'text' | 'voice'
    isPrivate: boolean
    /** For a private channel: the roles that see it. */
    viewRoleIds: string[]
    /** `managers`: only MANAGE_MESSAGES may post. */
    sendMode: 'everyone' | 'managers'
}

/** What every check in a server needs to know about the server. */
export interface AccessServer {
    ownerId: string
    roles: AccessRole[]
    channels: AccessChannel[]
}

/** What every check needs to know about one member. */
export interface AccessMember {
    userId: string
    /** Not including @everyone, which every member has. */
    roleIds: string[]
    timeoutUntil: Date | null
}

const isTimedOut = (member: AccessMember, now: Date) =>
    member.timeoutUntil !== null && member.timeoutUntil.getTime() > now.getTime()

/**
 * @everyone OR every role the member has, ignoring ids no longer on the
 * server and any bit that is not a permission (bit 9, or one above the last).
 */
function combinedRoles(server: AccessServer, member: AccessMember): bigint {
    const held = new Set(member.roleIds)
    const all = server.roles.reduce(
        (bits, role) => (role.isEveryone || held.has(role.id) ? bits | role.permissions : bits),
        0n
    )
    return all & ALL_PERMISSIONS
}

/** Whether the member holds one of these roles; @everyone, every member holds. */
function holdsAnyOf(server: AccessServer, member: AccessMember, roleIds: string[]): boolean {
    const wanted = new Set(roleIds)
    return server.roles.some((role) => wanted.has(role.id) && (role.isEveryone || member.roleIds.includes(role.id)))
}

/** Owner or ADMINISTRATOR: every permission, timeout or not (appendix B, step 1). */
function isAllPowerful(server: AccessServer, member: AccessMember, roles: bigint): boolean {
    return member.userId === server.ownerId || (roles & Permission.ADMINISTRATOR) !== 0n
}

/**
 * Permissions in the server as a whole, for actions not tied to a channel
 * (manage roles, kick, create an invite…): steps 1, 2 and 6 of appendix B.
 */
export function serverPermissions(server: AccessServer, member: AccessMember, now: Date): bigint {
    const roles = combinedRoles(server, member)
    if (isAllPowerful(server, member, roles)) return ALL_PERMISSIONS
    if (isTimedOut(member, now)) return roles & Permission.VIEW_CHANNEL
    return roles
}

/**
 * Permissions in one channel, appendix B steps 1–6. Zero means the member may
 * not even know the channel exists (NOT_FOUND, NFR-SEC-05): without
 * VIEW_CHANNEL every other bit is meaningless there.
 */
export function channelPermissions(
    server: AccessServer,
    member: AccessMember,
    channel: AccessChannel,
    now: Date
): bigint {
    // 1. Owner or ADMINISTRATOR.
    const roles = combinedRoles(server, member)
    if (isAllPowerful(server, member, roles)) return ALL_PERMISSIONS

    // 2. @everyone and every role, OR-ed.
    let granted = roles

    // 3. A private channel shows only to its roles. A channel nobody let the
    // member view is hidden the same way.
    if (channel.isPrivate && !holdsAnyOf(server, member, channel.viewRoleIds)) return 0n
    if ((granted & Permission.VIEW_CHANNEL) === 0n) return 0n

    // 4. A managers-only channel: posting needs MANAGE_MESSAGES.
    if (channel.sendMode === 'managers' && (granted & Permission.MANAGE_MESSAGES) === 0n) {
        granted &= ~(Permission.SEND_MESSAGES | Permission.ATTACH_FILES | Permission.MENTION_EVERYONE)
    }

    // 5. A voice room one cannot join gives nothing to do in it.
    if (channel.type === 'voice' && (granted & Permission.CONNECT) === 0n) {
        granted &= ~(Permission.SPEAK | Permission.VIDEO | Permission.MUTE_MEMBERS | Permission.MOVE_MEMBERS)
    }

    // 6. Timed out: viewing only.
    if (isTimedOut(member, now)) return Permission.VIEW_CHANNEL

    return granted
}

/** The member's rank: the owner above everyone, else their highest role. */
function rankOf(server: AccessServer, member: AccessMember): number {
    if (member.userId === server.ownerId) return Number.POSITIVE_INFINITY
    const held = new Set(member.roleIds)
    return server.roles.reduce((top, role) => (held.has(role.id) ? Math.max(top, role.position) : top), 0)
}

/**
 * Whether `actor` may act on `target` (kick, ban, time out, change roles):
 * only on someone ranked strictly lower, never on the owner (REQ-ROLE-02).
 * ADMINISTRATOR does not change rank. The owner's rank is infinite, so the
 * comparison alone keeps everyone off the owner, the owner included.
 */
export function outranksMember(server: AccessServer, actor: AccessMember, target: AccessMember): boolean {
    return rankOf(server, actor) > rankOf(server, target)
}

/** Whether `actor` may edit, delete or hand out `role`: only one below their highest. */
export function outranksRole(server: AccessServer, actor: AccessMember, role: AccessRole): boolean {
    return rankOf(server, actor) > role.position
}

/**
 * Whether someone holding `actorPermissions` (their server permissions) may
 * turn `before` into `after`: every bit that changes must be one they hold
 * (REQ-ROLE-02). Bits they lack may stay as they are.
 */
export function permissionChangeAllowed(actorPermissions: bigint, before: bigint, after: bigint): boolean {
    // Only real permission bits count: a stray bit stored on a role must not
    // lock that role against every edit, the owner's included.
    const changed = (before ^ after) & ALL_PERMISSIONS
    return (changed & ~actorPermissions) === 0n
}

/**
 * Whether someone holding `actorPermissions` may give `role` to a member or
 * take it away: doing so grants or removes every bit the role carries, so they
 * must hold them all (REQ-ROLE-02, "only grant or remove permissions one
 * holds"). Rank is checked separately (outranksRole).
 */
export function roleHandoutAllowed(actorPermissions: bigint, role: AccessRole): boolean {
    return (role.permissions & ALL_PERMISSIONS & ~actorPermissions) === 0n
}
