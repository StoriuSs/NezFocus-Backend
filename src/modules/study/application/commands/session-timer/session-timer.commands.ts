/**
 * End the running phase of a session, as set for `version` (ARCHITECTURE
 * 5.1): run by its job on the `study` queue, or by the sweep, never by a
 * route.
 */
export class EndFocusPhaseCommand {
    constructor(
        readonly sessionId: string,
        readonly version: number
    ) {}
}

/**
 * Run the study timers already due at `now` whose job was lost or late
 * (D-225), and check every room with a session against who is in it and
 * whether it is still a study room (D-227): run every minute by
 * src/maintenance.
 */
export class SweepStudyTimersCommand {
    constructor(readonly now: Date) {}
}

/**
 * Close the place of one away since `since` (D-215): run by its job on the
 * `study` queue 3 minutes on, or by the sweep.
 */
export class CloseAwayCommand {
    constructor(
        readonly participationId: string,
        readonly since: Date
    ) {}
}

/**
 * End the session whose room is empty since `since` (D-227): run by its job
 * on the `study` queue 5 minutes on, or by the sweep.
 */
export class EndEmptyRoomCommand {
    constructor(
        readonly sessionId: string,
        readonly since: Date
    ) {}
}
