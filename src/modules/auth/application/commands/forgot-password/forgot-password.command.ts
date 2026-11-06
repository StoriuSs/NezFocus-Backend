import { DEFAULT_EMAIL_LANGUAGE, EmailLanguage } from '../../ports'

export class ForgotPasswordCommand {
    constructor(
        public readonly email: string,
        public readonly ip: string,
        /** The page's language, for the email (D-132). */
        public readonly language: EmailLanguage = DEFAULT_EMAIL_LANGUAGE
    ) {}
}
