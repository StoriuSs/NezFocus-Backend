export class ResetPasswordCommand {
    constructor(
        public readonly email: string,
        public readonly code: string,
        public readonly newPassword: string,
        public readonly client: { ip: string; userAgent?: string }
    ) {}
}
