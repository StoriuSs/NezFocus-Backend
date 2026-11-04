export class ForgotPasswordCommand {
    constructor(
        public readonly email: string,
        public readonly ip: string,
        /** From the Turnstile widget; required when Turnstile is on. */
        public readonly captchaToken?: string
    ) {}
}
