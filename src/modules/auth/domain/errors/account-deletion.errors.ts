import { DomainError } from '@/shared/domain/domain-error'

/**
 * Deleting an account needs proof it is the owner, and none was sent:
 * `data.needs` lists what (the password). An account without a password
 * chooses one with "forgot password" first.
 */
export class ConfirmationRequiredError extends DomainError {
    readonly kind = 'invalid'
    readonly errorKey = 'AUTH_CONFIRMATION_REQUIRED'
    readonly details: { needs: 'password'[] }
    constructor(needs: 'password'[]) {
        super('Confirm it is you first.')
        this.details = { needs }
    }
}

/**
 * A signed-in route used by an account waiting to be deleted (D-141): signed
 * in again, and not restored yet. Only the profile and the restore route
 * answer; `data.deletes_at` says when it goes. Not a 401: the session is
 * fine, and clients sign out on any 401.
 */
export class AccountPendingDeletionError extends DomainError {
    readonly kind = 'forbidden'
    readonly errorKey = 'ACCOUNT_PENDING_DELETION'
    readonly details: { deletesAt: string }
    constructor(deletesAt: Date) {
        super('This account is waiting to be deleted. Restore it first.')
        this.details = { deletesAt: deletesAt.toISOString() }
    }
}

/** One server that stops its Owner deleting their account: someone else is in it. */
export interface BlockingServer {
    id: string
    name: string
    memberCount: number
}

/**
 * Deleting an account that still owns servers with other members
 * (REQ-AUTH-09, D-76): ownership is handed over first. `data.servers` lists
 * them, for the dialog that says so.
 */
export class OwnershipTransferRequiredError extends DomainError {
    readonly kind = 'conflict'
    readonly errorKey = 'OWNERSHIP_TRANSFER_REQUIRED'
    readonly details: { servers: BlockingServer[] }
    constructor(servers: BlockingServer[]) {
        super('Hand over the servers you own first.')
        this.details = { servers }
    }
}
