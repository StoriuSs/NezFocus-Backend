import { DEFAULT_EMAIL_LANGUAGE, EmailLanguage } from '../../ports'

/** What the person gave to prove it is them. */
export interface DeletionProof {
    password?: string
}

export class DeleteOwnAccountCommand {
    constructor(
        public readonly userId: string,
        public readonly proof: DeletionProof,
        /** The page's language, for the "account deleted" email (D-132). */
        public readonly language: EmailLanguage = DEFAULT_EMAIL_LANGUAGE
    ) {}
}
