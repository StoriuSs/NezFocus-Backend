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
