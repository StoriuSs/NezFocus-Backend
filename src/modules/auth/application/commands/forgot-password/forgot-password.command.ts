export class ForgotPasswordCommand {
    constructor(
        public readonly email: string,
        public readonly ip: string
    ) {}
}
