/*
 * The media of one-to-one calls (REQ-SOCIAL-05, ARCHITECTURE 6, D-239,
 * D-242, D-246): joining an active call's room at LiveKit (through voice's
 * CALL_MEDIA), what time does to an answered call nobody connected to or
 * somebody left, and a call ended by joining a voice room.
 */

/**
 * A token to join a call's room (`POST /calls/{id}/join`), for one of its
 * two while it is active; none otherwise (D-246). Carries the sign-in
 * session asking (D-214).
 */
export class JoinCallCommand {
    constructor(
        readonly userId: string,
        readonly callId: string,
        readonly sessionId: string
    ) {}
}

/**
 * The deadline of an active call's media, set for `version` (15 seconds to
 * connect, 30 to come back, D-242): run by its job on the `social` queue,
 * never by a route.
 */
export class CheckCallMediaCommand {
    constructor(
        readonly callId: string,
        readonly version: number
    ) {}
}

/**
 * End the active call `userId` is in, as if they hung up: they are joining a
 * voice room (one media connection per account, D-210, D-246). Sent by
 * voice through ACTIVE_CALLS, never by a route.
 */
export class EndActiveCallCommand {
    constructor(readonly userId: string) {}
}
