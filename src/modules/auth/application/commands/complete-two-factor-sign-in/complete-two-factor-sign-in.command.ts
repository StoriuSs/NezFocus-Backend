export class CompleteTwoFactorSignInCommand {
    constructor(
        public readonly challenge: string,
        /** Six digits from the app, or a recovery code. */
        public readonly code: string,
        public readonly client: { ip: string; userAgent?: string }
    ) {}
}
