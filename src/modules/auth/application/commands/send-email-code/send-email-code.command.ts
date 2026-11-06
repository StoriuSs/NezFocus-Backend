import type { EmailLanguage } from '../../ports'

/** Email a sign-in code: the first step of creating an account and of signing in with a code (D-59, D-60). */
export class SendEmailCodeCommand {
    constructor(
        public readonly email: string,
        /** The page's language, for the email (D-132). */
        public readonly language: EmailLanguage,
        public readonly ip: string
    ) {}
}
