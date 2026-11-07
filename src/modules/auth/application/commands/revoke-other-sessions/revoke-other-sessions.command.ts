export class RevokeOtherSessionsCommand {
    /** @param currentSessionId the session of the request, which stays */
    constructor(
        public readonly userId: string,
        public readonly currentSessionId: string
    ) {}
}
