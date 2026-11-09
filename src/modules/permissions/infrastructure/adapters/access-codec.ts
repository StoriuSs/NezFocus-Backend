import { AccessMember, AccessServer, fromWire, toWire } from '../../domain'

/*
 * How the two cache entries look in Redis (D-146). JSON has no BigInt and no
 * Date: JSON.stringify throws on the first, and turns the second into a
 * string that JSON.parse leaves a string. So the bits travel as a decimal
 * string and the timeout as epoch milliseconds, and are turned back here.
 */

export interface CachedServer {
    ownerId: string
    roles: { id: string; permissions: string; position: number; isEveryone: boolean }[]
    channels: AccessServer['channels']
}

export interface CachedMember {
    userId: string
    roleIds: string[]
    timeoutUntil: number | null
}

export const encodeServer = (server: AccessServer): CachedServer => ({
    ownerId: server.ownerId,
    roles: server.roles.map((role) => ({ ...role, permissions: toWire(role.permissions) })),
    channels: server.channels
})

export const decodeServer = (cached: CachedServer): AccessServer => ({
    ownerId: cached.ownerId,
    roles: cached.roles.map((role) => ({ ...role, permissions: fromWire(role.permissions) })),
    channels: cached.channels
})

export const encodeMember = (member: AccessMember): CachedMember => ({
    userId: member.userId,
    roleIds: member.roleIds,
    timeoutUntil: member.timeoutUntil?.getTime() ?? null
})

export const decodeMember = (cached: CachedMember): AccessMember => ({
    userId: cached.userId,
    roleIds: cached.roleIds,
    timeoutUntil: cached.timeoutUntil === null ? null : new Date(cached.timeoutUntil)
})
