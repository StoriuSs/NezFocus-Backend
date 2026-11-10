import { DomainError } from '@/shared/domain/domain-error'

/** No such role in the server: the same answer for a role of another server. */
export class RoleNotFoundError extends DomainError {
    readonly kind = 'not_found'
    readonly errorKey = 'NOT_FOUND'

    constructor(roleId: string) {
        super(`Role not found: ${roleId}`)
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
