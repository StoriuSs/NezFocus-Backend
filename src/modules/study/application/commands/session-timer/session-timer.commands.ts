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
 * (D-225): run every minute by src/maintenance.
 */
export class SweepStudyTimersCommand {
    constructor(readonly now: Date) {}
}
