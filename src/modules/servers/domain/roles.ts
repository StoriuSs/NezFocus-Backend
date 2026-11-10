import {
    AccessMember,
    ALL_PERMISSIONS,
    outranksMember,
    outranksRole,
    Permission,
    PermissionName,
    permissionChangeAllowed,
    roleHandoutAllowed,
    serverPermissions
} from '@/modules/permissions'
import { freeNameProblem, normaliseFreeName } from './channel-name.rules'
import { RoleSnapshot, ServerSnapshot } from './member-view'
import { nameKey } from './name-key'
import {
    MemberNotFoundError,
    MissingPermissionError,
    RoleHierarchyError,
    RoleNotFoundError,
    RoleOrderStaleError,
    RoleRuleError
} from './errors'

/*
 * The roles of one server (REQ-ROLE-01, ROLE-02, D-87, D-148, D-153). As with
 * the channel list, every change is decided here by a pure function, from the
 * server and the members concerned as read inside the write's transaction
 * with the server row locked; the repository only carries out the writes.
 * Ranks are therefore compared on fresh rows, never on the permission cache
 * (no write skew between two people editing roles at once).
 *
 * Positions: @everyone is 0; the other roles hold 1…n with no gap and no
 * repeat, higher being more senior. Every write here keeps that true.
 */

/** The most roles a server may have, @everyone not counted (REQ-ROLE-01, D-153). */
export const MAX_ROLES = 50
/** The most people added to a role in one request (D-153). */
export const MAX_ROLE_GRANT = 100

/** The server, the person acting, and the members a change names, as read under the lock. */
export interface RoleState {
    server: ServerSnapshot
    member: AccessMember
    /** The members named by the change that are in the server; someone missing is not here. */
    targets: AccessMember[]
}

/** What "Edit role" (S-SET-02) changes; anything left out stays. */
export interface RoleEdit {
    name?: string
    permissions?: bigint
    mentionable?: boolean
}

export interface RoleChanges {
    name?: string
    nameKey?: string
    permissions?: bigint
    mentionable?: boolean
}

export type RoleWrite =
    | { kind: 'createRole'; name: string; nameKey: string; position: number }
    | { kind: 'updateRole'; id: string; changes: RoleChanges }
    | { kind: 'deleteRole'; id: string }
    | { kind: 'placeRoles'; places: { id: string; position: number }[] }
    | { kind: 'grantRole'; roleId: string; userIds: string[] }
    | { kind: 'revokeRole'; roleId: string; userId: string }

// --- Who may ---------------------------------------------------------------

const accessOf = (server: ServerSnapshot) => ({
    ownerId: server.ownerId,
    roles: server.roles,
    channels: server.channels
})

/** MANAGE_ROLES in the server; answers with everything they hold there. */
function requireManageRoles({ server, member }: RoleState, now: Date): bigint {
    const granted = serverPermissions(accessOf(server), member, now)
    if ((granted & Permission.MANAGE_ROLES) === 0n) throw new MissingPermissionError('MANAGE_ROLES')
    return granted
}

function requireRole({ server }: RoleState, roleId: string): RoleSnapshot {
    const role = server.roles.find((r) => r.id === roleId)
    if (!role) throw new RoleNotFoundError(roleId)
    return role
}

/** A role strictly below their highest (the owner: any). */
function requireOutranks(state: RoleState, role: RoleSnapshot): void {
    if (!outranksRole(accessOf(state.server), state.member, role)) throw new RoleHierarchyError()
}

/**
 * Handing out, taking back or deleting a role grants or removes every bit it
 * carries, so they must hold them all (D-148). The error names the first one
 * missing, for the log; the client already greys the control out.
 */
function requireHoldsAll(held: bigint, role: RoleSnapshot): void {
    if (roleHandoutAllowed(held, role)) return
    throw new MissingPermissionError(firstMissing(role.permissions & ALL_PERMISSIONS & ~held))
}

function firstMissing(bits: bigint): PermissionName {
    const name = (Object.keys(Permission) as PermissionName[]).find((key) => (bits & Permission[key]) !== 0n)
    return name ?? 'ADMINISTRATOR'
}

/** Themselves, or someone ranked below them (REQ-ROLE-02, D-153). */
function requireMayChange(state: RoleState, target: AccessMember): void {
    if (target.userId === state.member.userId) return
    if (!outranksMember(accessOf(state.server), state.member, target)) throw new RoleHierarchyError()
}

// --- Names and order -------------------------------------------------------

const RESERVED = new Set(['everyone', 'here'])

/**
 * The name as a mention would read it: compatibility forms folded ("＠" is
 * "@"), invisible characters and spaces dropped, every leading @ removed.
 * "@@Every one" and "every\u200Bone" are both "everyone".
 */
function reservedForm(name: string): string {
    return name
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\s\u00ad\u200b-\u200f\u2060-\u2064\ufeff]/g, '')
        .replace(/^@+/, '')
}

/** The name as stored, with its key; refused when empty, too long, or the system's. */
function roleName(state: RoleState, typed: string, exceptId: string | null): { name: string; nameKey: string } {
    const name = normaliseFreeName(typed)
    if (freeNameProblem(name)) throw new RoleRuleError('name_invalid')
    const key = nameKey(name)
    if (RESERVED.has(reservedForm(name))) throw new RoleRuleError('name_reserved')
    if (state.server.roles.some((role) => role.id !== exceptId && nameKey(role.name) === key)) {
        throw new RoleRuleError('name_taken')
    }
    return { name, nameKey: key }
}

/** Every role but @everyone, highest first: the order of the Roles page. */
export function rolesHighestFirst(roles: RoleSnapshot[]): RoleSnapshot[] {
    return roles.filter((role) => !role.isEveryone).sort((a, b) => b.position - a.position || a.id.localeCompare(b.id))
}

/** The places that make `ids` (highest first) hold n…1, for the roles whose place changes. */
function placesFor(ids: string[], roles: RoleSnapshot[]): { id: string; position: number }[] {
    const now = new Map(roles.map((role) => [role.id, role.position]))
    return ids
        .map((id, index) => ({ id, position: ids.length - index }))
        .filter((place) => now.get(place.id) !== place.position)
}

/**
 * Whether positions are as they must be: @everyone at 0, the others 1…n with
 * no gap or repeat. What every write here keeps; checked by the tests.
 */
export function rolePositionsValid(roles: Pick<RoleSnapshot, 'position' | 'isEveryone'>[]): boolean {
    const everyone = roles.filter((role) => role.isEveryone)
    if (everyone.length !== 1 || everyone[0]!.position !== 0) return false
    const others = roles
        .filter((role) => !role.isEveryone)
        .map((role) => role.position)
        .sort((a, b) => a - b)
    return others.every((position, index) => position === index + 1)
}

// --- Changes ---------------------------------------------------------------

/**
 * A new role with no permissions, not mentionable, right below the creator's
 * highest role; the owner's, or that of someone holding no role, goes on top
 * (REQ-ROLE-01, D-87). Everything at or above that place moves up one.
 */
export function planCreateRole(state: RoleState, typed: string, now: Date): RoleWrite[] {
    requireManageRoles(state, now)
    const others = rolesHighestFirst(state.server.roles)
    if (others.length >= MAX_ROLES) throw new RoleRuleError('limit')
    const { name, nameKey: key } = roleName(state, typed, null)

    const isOwner = state.member.userId === state.server.ownerId
    const held = new Set(state.member.roleIds)
    const top = others.find((role) => held.has(role.id))
    if (isOwner || !top) return [{ kind: 'createRole', name, nameKey: key, position: others.length + 1 }]

    const raised = others
        .filter((role) => role.position >= top.position)
        .map((role) => ({ id: role.id, position: role.position + 1 }))
    return [
        { kind: 'placeRoles', places: raised },
        { kind: 'createRole', name, nameKey: key, position: top.position }
    ]
}

/**
 * Name, permissions or "allow anyone to mention" of a role below their own
 * highest (REQ-ROLE-02). Each permission that changes must be one they hold;
 * @everyone has only its permissions to change.
 */
export function planUpdateRole(state: RoleState, roleId: string, edit: RoleEdit, now: Date): RoleWrite[] {
    const held = requireManageRoles(state, now)
    const role = requireRole(state, roleId)
    requireOutranks(state, role)
    if (role.isEveryone && (edit.name !== undefined || edit.mentionable !== undefined)) {
        throw new RoleRuleError('everyone_fixed')
    }

    const changes: RoleChanges = {}
    if (edit.name !== undefined) Object.assign(changes, roleName(state, edit.name, role.id))
    if (edit.mentionable !== undefined) changes.mentionable = edit.mentionable
    if (edit.permissions !== undefined) {
        if ((edit.permissions & ~ALL_PERMISSIONS) !== 0n) throw new RoleRuleError('unknown_bits')
        if (!permissionChangeAllowed(held, role.permissions, edit.permissions)) {
            throw new MissingPermissionError(firstMissing((role.permissions ^ edit.permissions) & ~held))
        }
        changes.permissions = edit.permissions
    }
    return Object.keys(changes).length === 0 ? [] : [{ kind: 'updateRole', id: role.id, changes }]
}

/**
 * Deletes a role below their highest whose every bit they hold (deleting it
 * takes those bits from its members, as taking the role back would, D-148).
 * The roles above it move down one, so no gap is left. Its members and the
 * private channels it showed go with it (cascade).
 */
export function planDeleteRole(state: RoleState, roleId: string, now: Date): RoleWrite[] {
    const held = requireManageRoles(state, now)
    const role = requireRole(state, roleId)
    if (role.isEveryone) throw new RoleRuleError('everyone_fixed')
    requireOutranks(state, role)
    requireHoldsAll(held, role)

    const lowered = rolesHighestFirst(state.server.roles)
        .filter((other) => other.position > role.position)
        .map((other) => ({ id: other.id, position: other.position - 1 }))
    return [
        { kind: 'deleteRole', id: role.id },
        ...(lowered.length > 0 ? [{ kind: 'placeRoles' as const, places: lowered }] : [])
    ]
}

/**
 * A new order of the roles but @everyone, highest first, with the order the
 * client was looking at (04 Edge): when that is no longer the order, nothing
 * moves and they reload. Someone not the owner moves only roles below their
 * highest, and puts none at or above it (REQ-ROLE-02): every role from theirs
 * up keeps its place.
 */
export function planReorderRoles(state: RoleState, seen: string[], wanted: string[], now: Date): RoleWrite[] {
    requireManageRoles(state, now)
    const others = rolesHighestFirst(state.server.roles)
    const current = others.map((role) => role.id)
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((id, index) => id === b[index])
    // A malformed request first, so it is not taken for a stale list and reloaded for ever: two
    // lists of the same roles, each once.
    if (new Set(seen).size !== seen.length || !same([...seen].sort(), [...wanted].sort())) {
        throw new RoleRuleError('order_invalid')
    }
    if (!same(seen, current)) throw new RoleOrderStaleError()

    if (state.member.userId !== state.server.ownerId) {
        const held = new Set(state.member.roleIds)
        const top = others.find((role) => held.has(role.id))
        // Someone holding no role ranks with @everyone: every role is above them.
        const fixed = top ? others.filter((role) => role.position >= top.position).length : current.length
        if (!same(wanted.slice(0, fixed), current.slice(0, fixed))) throw new RoleHierarchyError()
    }

    const places = placesFor(wanted, others)
    return places.length === 0 ? [] : [{ kind: 'placeRoles', places }]
}

/**
 * Gives a role to the people named, all or none (D-153): each must be in the
 * server and be themselves or ranked below the one adding, who must outrank
 * the role and hold all its bits (D-148). Those who have it already are left
 * as they are.
 */
export function planGrantRole(state: RoleState, roleId: string, userIds: string[], now: Date): RoleWrite[] {
    const held = requireManageRoles(state, now)
    const role = requireRole(state, roleId)
    if (role.isEveryone) throw new RoleRuleError('everyone_fixed')
    requireOutranks(state, role)
    requireHoldsAll(held, role)

    const byId = new Map(state.targets.map((target) => [target.userId, target]))
    const adding: string[] = []
    for (const userId of new Set(userIds)) {
        const target = byId.get(userId)
        if (!target) throw new MemberNotFoundError(userId)
        // Someone who has it already is left as they are, whatever their rank.
        if (target.roleIds.includes(role.id)) continue
        requireMayChange(state, target)
        adding.push(userId)
    }
    return adding.length === 0 ? [] : [{ kind: 'grantRole', roleId: role.id, userIds: adding }]
}

/** Takes a role back from one member, on the same terms as giving it; nothing when they lack it. */
export function planRevokeRole(state: RoleState, roleId: string, userId: string, now: Date): RoleWrite[] {
    const held = requireManageRoles(state, now)
    const role = requireRole(state, roleId)
    if (role.isEveryone) throw new RoleRuleError('everyone_fixed')
    requireOutranks(state, role)
    requireHoldsAll(held, role)

    const target = state.targets.find((member) => member.userId === userId)
    if (!target) throw new MemberNotFoundError(userId)
    requireMayChange(state, target)
    return target.roleIds.includes(role.id) ? [{ kind: 'revokeRole', roleId: role.id, userId }] : []
}
