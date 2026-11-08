import { DEFAULT_EMAIL_LANGUAGE, EmailLanguage } from '../../ports'

export class DeleteOwnAccountCommand {
    constructor(
        public readonly userId: string,
        /** The account's password: the proof it is the owner. */
        public readonly password: string,
        /** The page's language, for the email that says when the account goes (D-132). */
        public readonly language: EmailLanguage = DEFAULT_EMAIL_LANGUAGE
    ) {}
}
