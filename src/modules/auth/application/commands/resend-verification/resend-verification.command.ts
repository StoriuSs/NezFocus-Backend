export class ResendVerificationCommand {
    constructor(
        public readonly email: string,
        public readonly ip: string
    ) {}
}
