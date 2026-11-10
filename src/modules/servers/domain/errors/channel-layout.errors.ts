import { DomainError } from '@/shared/domain/domain-error'

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
