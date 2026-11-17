/**
 * Domain Event: Account Deletion Requested
 *
 * Published once someone asked to delete their account (REQ-AUTH-09, D-141)
 * and every session of theirs ended. Others see the account as deleted from
 * now on (D-182): the realtime module shows it offline at once, rather than
 * keep what was shown for the 60 seconds a closed tab is held for (it can
 * have no tab any more, until it signs in again to restore the account).
 */
export class AccountDeletionRequestedEvent {
    constructor(public readonly userId: string) {}
}
