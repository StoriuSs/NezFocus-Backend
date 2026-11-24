/*
 * One-to-one calls (REQ-SOCIAL-05, SOCIAL-06, ARCHITECTURE 6, D-242,
 * D-245): calling from a DM, answering, declining, hanging up, and what
 * time does to a call nobody answers. Its media (the LiveKit room) is the
 * area call-media (M6 L4b).
 */

/** Call the other one of my DM (`POST /dms/{id}/calls`); answers the call (made, or the one already open there). */
export class StartCallCommand {
    constructor(
        readonly userId: string,
        readonly dmChannelId: string,
        readonly video: boolean
    ) {}
}

/** Answer a call ringing to me (`POST /calls/{id}/accept`). */
export class AcceptCallCommand {
    constructor(
        readonly userId: string,
        readonly callId: string
    ) {}
}

/** Decline a call ringing to me (`POST /calls/{id}/decline`). */
export class DeclineCallCommand {
    constructor(
        readonly userId: string,
        readonly callId: string
    ) {}
}

/** Hang up a call of mine, ringing or active (`POST /calls/{id}/end`). */
export class EndCallCommand {
    constructor(
        readonly userId: string,
        readonly callId: string
    ) {}
}

/**
 * Miss a call still ringing at `version` 45 seconds on: run by its job on
 * the `social` queue, or by the sweep, never by a route.
 */
export class RingOutCallCommand {
    constructor(
        readonly callId: string,
        readonly version: number
    ) {}
}

/**
 * Run the call timers already due at `now` whose job was lost or is late
 * (D-242): run every minute by src/maintenance.
 */
export class SweepCallTimersCommand {
    constructor(readonly now: Date) {}
}
