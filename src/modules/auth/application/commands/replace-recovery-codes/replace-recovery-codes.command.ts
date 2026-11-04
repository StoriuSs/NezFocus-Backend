export class ReplaceRecoveryCodesCommand {
    constructor(
        public readonly userId: string,
        /** A code from the app. */
        public readonly code: string
    ) {}
}
