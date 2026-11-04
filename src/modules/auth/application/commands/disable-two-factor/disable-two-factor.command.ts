export class DisableTwoFactorCommand {
    constructor(
        public readonly userId: string,
        /** A code from the app, or a recovery code. */
        public readonly code: string
    ) {}
}
