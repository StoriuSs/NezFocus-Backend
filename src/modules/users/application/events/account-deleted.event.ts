/**
 * Domain Event: Account Deleted
 *
 * Published when a user account is soft-deleted. Event handlers react to it
 * to purge what the account leaves behind.
 */
export class AccountDeletedEvent {
    constructor(
        public readonly userId: string,
        /** Stored avatar key, if the account had one, so it can be purged. */
        public readonly avatarUrl?: string | null,
        /** Its owner asked to delete it (D-141); false: a sign-up left incomplete. */
        public readonly ownerAsked = false
    ) {}
}
