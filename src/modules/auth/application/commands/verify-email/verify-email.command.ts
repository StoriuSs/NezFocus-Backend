export class VerifyEmailCommand {
    constructor(
        public readonly email: string,
        public readonly code: string,
        /** The password the address was signed up with. */
        public readonly password: string,
        public readonly client: { ip: string; userAgent?: string }
    ) {}
}
