import { DEFAULT_EMAIL_LANGUAGE, EmailLanguage } from '../../ports'

export class ChangePasswordCommand {
    constructor(
        public readonly userId: string,
        /** The session making the change, which stays signed in. */
        public readonly sessionId: string,
        public readonly currentPassword: string,
        public readonly newPassword: string,
        /** The page's language, for the "password changed" email (D-132). */
        public readonly language: EmailLanguage = DEFAULT_EMAIL_LANGUAGE
    ) {}
}
