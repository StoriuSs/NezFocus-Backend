export class LoginCommand {
    constructor(
        public readonly email: string,
        public readonly password: string,
        public readonly client: { ip: string; userAgent?: string },
        /** From the Turnstile widget; needed from the third failure when Turnstile is on. */
        public readonly captchaToken?: string
    ) {}
}
