import { DomainError } from '@/shared/domain/domain-error'

/** The most servers one person may be in (REQ-SRV-01). */
export const MAX_SERVERS_PER_USER = 100

/** Already in 100 servers: leave one before creating or joining another. */
export class MaxServersReachedError extends DomainError {
    readonly kind = 'forbidden'
    readonly errorKey = 'MAX_SERVERS_REACHED'

    constructor() {
        super(`Already in ${MAX_SERVERS_PER_USER} servers`)
    }
}

/**
 * No such server, deleted, or not one they are in: the same answer for all
 * three, so a stranger learns nothing from an id (NFR-SEC-05).
 */
export class ServerNotFoundError extends DomainError {
    readonly kind = 'not_found'
    readonly errorKey = 'NOT_FOUND'

    constructor(serverId: string) {
        super(`Server not found: ${serverId}`)
    }
}

/** A member of the server, without the permission this needs. */
export class MissingPermissionError extends DomainError {
    readonly kind = 'forbidden'
    readonly errorKey = 'FORBIDDEN'

    constructor(permission: string) {
        super(`Missing permission: ${permission}`)
    }
}

/** No such channel in the server, or one they cannot see: the same answer (NFR-SEC-05). */
export class ChannelNotFoundError extends DomainError {
    readonly kind = 'not_found'
    readonly errorKey = 'NOT_FOUND'

    constructor(channelId: string) {
        super(`Channel not found: ${channelId}`)
    }
}

export class CategoryNotFoundError extends DomainError {
    readonly kind = 'not_found'
    readonly errorKey = 'NOT_FOUND'

    constructor(categoryId: string) {
        super(`Category not found: ${categoryId}`)
    }
}

/**
 * Which rule of the channel list a change broke (REQ-SRV-02, D-84, D-149):
 * - `name_invalid`: empty, too long, or nothing left of a text channel's name;
 * - `name_taken`: the group (or the server, for a category) has that name;
 * - `limit`: 500 channels and categories already;
 * - `view_roles`: a role not in the server, @everyone, or roles on a public channel;
 * - `not_for_type`: a study room that is not a voice room, who may post in a room;
 * - `stale_move`: the place it was dropped at no longer exists (someone moved
 *   or deleted it meanwhile): reload and try again.
 */
export type LayoutRule = 'name_invalid' | 'name_taken' | 'limit' | 'view_roles' | 'not_for_type' | 'stale_move'

/** A change to the channel list that breaks one of its rules. `data.rule` says which. */
export class LayoutRuleError extends DomainError {
    readonly kind = 'unprocessable'
    readonly errorKey = 'VALIDATION_ERROR'
    readonly details: { rule: LayoutRule } & Record<string, unknown>

    constructor(rule: LayoutRule, details: Record<string, unknown> = {}) {
        super(`Channel list rule broken: ${rule}`)
        this.details = { rule, ...details }
    }
}

/**
 * No such code, used up, out of time, revoked, or its server deleted: one
 * answer for all, so a guess learns nothing more (REQ-SRV-03).
 */
export class InviteInvalidError extends DomainError {
    readonly kind = 'gone'
    readonly errorKey = 'INVITE_INVALID'

    constructor() {
        super('This invite is invalid or has expired')
    }
}

/** Banned from the server: no invite lets them back in (REQ-SRV-04, ROLE-04). */
export class BannedFromServerError extends DomainError {
    readonly kind = 'forbidden'
    readonly errorKey = 'BANNED_FROM_SERVER'

    constructor() {
        super('You cannot join this server')
    }
}

/**
 * Too many wrong invite codes from this network (REQ-SRV-03): `data.reason`
 * is `network`, as the auth limits counted per IP, so a page can say that
 * others on a shared network count too.
 */
export class InviteGuessesLimitedError extends DomainError {
    readonly kind = 'rate_limited'
    readonly errorKey = 'RATE_LIMIT_EXCEEDED'
    readonly details = { reason: 'network' }

    constructor(readonly retryAfterSeconds: number) {
        super(`Too many wrong invite codes from your network. Try again in ${retryAfterSeconds} seconds.`)
    }
}

/** No such role in the server: the same answer for a role of another server. */
export class RoleNotFoundError extends DomainError {
    readonly kind = 'not_found'
    readonly errorKey = 'NOT_FOUND'

    constructor(roleId: string) {
        super(`Role not found: ${roleId}`)
    }
}

/** Someone named is not (or no longer) a member of the server. */
export class MemberNotFoundError extends DomainError {
    readonly kind = 'not_found'
    readonly errorKey = 'NOT_FOUND'

    constructor(userId: string) {
        super(`Member not found: ${userId}`)
    }
}

/**
 * A role, or a member, ranked level with or above the one acting
 * (REQ-ROLE-02): only what is strictly below one's highest role is theirs to
 * change.
 */
export class RoleHierarchyError extends DomainError {
    readonly kind = 'forbidden'
    readonly errorKey = 'ROLE_HIERARCHY_VIOLATION'

    constructor() {
        super('Only roles and members below your highest role can be changed')
    }
}

/**
 * Which rule of the role list a change broke (REQ-ROLE-01, D-87):
 * - `name_invalid`: empty or longer than 100 characters;
 * - `name_taken`: the server has a role by that name;
 * - `name_reserved`: everyone or here, with or without @;
 * - `limit`: 50 roles already, @everyone not counted;
 * - `everyone_fixed`: @everyone keeps its name and place, is not mentioned
 *   by name, and is neither handed out nor deleted;
 * - `unknown_bits`: a bit that is no permission of appendix B;
 * - `order_invalid`: the new order is not the same roles.
 */
export type RoleRule =
    | 'name_invalid'
    | 'name_taken'
    | 'name_reserved'
    | 'limit'
    | 'everyone_fixed'
    | 'unknown_bits'
    | 'order_invalid'

/** A change to the roles that breaks one of their rules. `data.rule` says which. */
export class RoleRuleError extends DomainError {
    readonly kind = 'unprocessable'
    readonly errorKey = 'VALIDATION_ERROR'
    readonly details: { rule: RoleRule }

    constructor(rule: RoleRule) {
        super(`Role rule broken: ${rule}`)
        this.details = { rule }
    }
}

/**
 * The order sent was decided on a list that has changed since (someone else
 * moved, added or deleted a role): reload and drag again (04 Edge).
 */
export class RoleOrderStaleError extends DomainError {
    readonly kind = 'conflict'
    readonly errorKey = 'CONFLICT'

    constructor() {
        super('The roles have changed since you loaded them')
    }
}
