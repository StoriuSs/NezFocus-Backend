import { DomainError } from '@/shared/domain/domain-error'

/** The owner hands the server over before leaving it (REQ-SRV-05). */
export class OwnerCannotLeaveError extends DomainError {
    readonly kind = 'forbidden'
    readonly errorKey = 'OWNER_CANNOT_LEAVE'
    constructor() {
        super('The owner cannot leave the server: hand it over first')
    }
}

/** Only the owner deletes the server or hands it over, whatever roles others hold. */
export class NotOwnerError extends DomainError {
    readonly kind = 'forbidden'
    readonly errorKey = 'FORBIDDEN'
    constructor() {
        super('Only the owner may do this')
    }
}

/**
 * Which rule of deleting a server or handing it over was broken (REQ-SRV-05):
 * - `name_mismatch`: the name typed to confirm is not the server's;
 * - `recipient_self`: the owner named themselves;
 * - `recipient_pending_deletion`: that account is waiting to be deleted;
 * - `recipient_timed_out`: that member is timed out, end it first (D-91).
 */
export type MembershipRule = 'name_mismatch' | 'recipient_self' | 'recipient_pending_deletion' | 'recipient_timed_out'

/** A deletion or handover that breaks one of their rules. `data.rule` says which. */
export class MembershipRuleError extends DomainError {
    readonly kind = 'unprocessable'
    readonly errorKey = 'VALIDATION_ERROR'
    readonly details: { rule: MembershipRule }
    constructor(rule: MembershipRule) {
        super(`Membership rule broken: ${rule}`)
        this.details = { rule }
    }
}
