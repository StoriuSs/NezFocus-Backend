/** The sweep at `now`: deletes the accounts whose 14 days are over (dueForDeletion). */
export class SweepDeletedAccountsCommand {
    constructor(public readonly now: Date) {}
}
