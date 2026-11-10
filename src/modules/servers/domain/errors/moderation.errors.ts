import { DomainError } from '@/shared/domain/domain-error'

/** The person named is not banned from the server. */
export class BanNotFoundError extends DomainError {
    readonly kind = 'not_found'
    readonly errorKey = 'NOT_FOUND'

    constructor(userId: string) {
        super(`Ban not found: ${userId}`)
    }
}

/**
 * Which rule of a kick, ban or timeout was broken (REQ-ROLE-04):
 * - `reason_too_long`: past 512 characters;
 * - `timeout_invalid`: not one of the six lengths;
 * - `target_admin`: they hold ADMINISTRATOR, take that role first (D-147).
 */
export type ModerationRule = 'reason_too_long' | 'timeout_invalid' | 'target_admin'

/** A kick, ban or timeout that breaks one of their rules. `data.rule` says which. */
export class ModerationRuleError extends DomainError {
    readonly kind = 'unprocessable'
    readonly errorKey = 'VALIDATION_ERROR'
    readonly details: { rule: ModerationRule }

    constructor(rule: ModerationRule) {
        super(`Moderation rule broken: ${rule}`)
        this.details = { rule }
    }
}
