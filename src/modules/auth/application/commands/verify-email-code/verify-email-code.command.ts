/** Sign in with the code from SendEmailCodeCommand, making the account if the address has none. */
export class VerifyEmailCodeCommand {
    constructor(
        public readonly email: string,
        public readonly code: string,
        public readonly client: { ip: string; userAgent?: string }
    ) {}
}
