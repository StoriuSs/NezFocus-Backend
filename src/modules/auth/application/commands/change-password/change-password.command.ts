export class ChangePasswordCommand {
    constructor(
        public readonly userId: string,
        /** The session making the change, which stays signed in. */
        public readonly sessionId: string,
        public readonly currentPassword: string,
        public readonly newPassword: string
    ) {}
}
