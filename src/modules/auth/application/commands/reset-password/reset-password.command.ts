import { DEFAULT_EMAIL_LANGUAGE, EmailLanguage } from '../../ports'

export class ResetPasswordCommand {
    constructor(
        public readonly email: string,
        public readonly code: string,
        public readonly newPassword: string,
        public readonly client: { ip: string; userAgent?: string },
        /** The page's language, for the "password changed" email (D-132). */
        public readonly language: EmailLanguage = DEFAULT_EMAIL_LANGUAGE
    ) {}
}
