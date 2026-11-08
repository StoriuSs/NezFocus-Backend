/** "Restore account" in the dialog shown on signing in to an account waiting to be deleted (D-141). */
export class RestoreAccountCommand {
    constructor(public readonly userId: string) {}
}
