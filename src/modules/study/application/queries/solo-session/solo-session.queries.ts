/**
 * A person's Solo not yet ended, and the cycle their next one starts with
 * (`GET /me/solo-session`, D-229).
 */
export class GetSoloSessionQuery {
    constructor(readonly userId: string) {}
}
