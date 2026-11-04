/**
 * SetUsernameCommand
 *
 * Command to set a user's username for the first time (one-time action).
 */
export class SetUsernameCommand {
    constructor(
        public readonly userId: string,
        public readonly username: string
    ) {}
}
