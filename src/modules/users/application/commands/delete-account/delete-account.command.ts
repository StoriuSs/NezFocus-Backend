/**
 * DeleteAccountCommand
 *
 * Command to soft-delete a user account and purge what it leaves behind.
 */
export class DeleteAccountCommand {
    constructor(
        public readonly userId: string,
        public readonly actorId?: string
    ) {}
}
