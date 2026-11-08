/**
 * Domain Event: Account Deleted
 *
 * Published when a user account is soft-deleted. Event handlers react to it
 * to purge what the account leaves behind in other modules. The avatar file
 * is not among them: the sweep removes it itself, from the key the row keeps
 * (SweepDeletedAccountsHandler), so a lost event cannot lose the file.
 */
export class AccountDeletedEvent {
    constructor(
        public readonly userId: string,
        /** Its owner asked to delete it (D-141); false: a sign-up left incomplete. */
        public readonly ownerAsked = false
    ) {}
}
