/*
 * Reads of calls (REQ-SOCIAL-05, D-242, D-245): one call of mine, and my
 * open calls on opening the app or reloading it.
 */

/** One call of mine as I see it, for the answer to a command on it (D-159); null when not mine. */
export class GetCallQuery {
    constructor(
        readonly userId: string,
        readonly callId: string
    ) {}
}

/** My open calls (`GET /me/call`, D-245): the one I make or am in, and those ringing to me. */
export class GetMyCallQuery {
    constructor(readonly userId: string) {}
}
