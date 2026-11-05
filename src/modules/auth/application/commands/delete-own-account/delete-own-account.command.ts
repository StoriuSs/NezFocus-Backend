/** What the person gave to prove it is them; which ones are needed depends on the account. */
export interface DeletionProof {
    password?: string
    /** The code emailed by SendAccountDeletionCodeCommand. */
    code?: string
}

export class DeleteOwnAccountCommand {
    constructor(
        public readonly userId: string,
        public readonly proof: DeletionProof,
        public readonly ip: string
    ) {}
}
