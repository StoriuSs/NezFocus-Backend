export class SetPasswordCommand {
    constructor(
        public readonly userId: string,
        public readonly code: string,
        public readonly newPassword: string,
        public readonly ip: string
    ) {}
}
