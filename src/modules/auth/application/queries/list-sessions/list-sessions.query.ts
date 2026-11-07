export class ListSessionsQuery {
    /** @param currentSessionId the session of the request: listed first, as this device */
    constructor(
        public readonly userId: string,
        public readonly currentSessionId: string
    ) {}
}
