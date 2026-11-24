/**
 * Active Calls Port — the one-to-one calls of social, as far as voice needs
 * them: one media connection per account (D-210, D-242), so joining a voice
 * room ends the call one is in. Answered by social through a global module
 * (D-246): social uses voice (CALL_MEDIA), never the other way.
 */
export interface ActiveCallsPort {
    /**
     * Ends the active call `userId` is in, as if they hung up: `ended`, its
     * message in the DM, its room closed. A call still ringing, or none, is
     * left as it is.
     */
    endFor(userId: string): Promise<void>
}

export const ACTIVE_CALLS = Symbol('ActiveCallsPort')
