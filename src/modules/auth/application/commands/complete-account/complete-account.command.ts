import { EmailLanguage } from '../../ports'

/** What the "complete your account" page sends (S-ONB-01), shape already checked. */
export interface AccountCompletionForm {
    /** 1-32 characters, trimmed. */
    displayName: string
    /** Matches USERNAME_PATTERN once normalised. Taken or not is decided here. */
    username: string
    password: string
    /** An IANA zone name ICU knows. */
    timezone: string
    /** The language switch at the foot of the page, saved to the account (D-64). */
    language: EmailLanguage
}

export class CompleteAccountCommand {
    constructor(
        public readonly userId: string,
        public readonly form: AccountCompletionForm
    ) {}
}
