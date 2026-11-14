/*
 * Presence (REQ-AUTH-07, ARCHITECTURE 3.3, D-174): each tab's socket as it
 * comes, beats, goes unused and goes; the sweep finds those gone without
 * saying. What others see is decided by domain/presence.rules.ts, told by
 * services/presence.ts.
 */

/** A socket let in: answers what others now see of its person, for `ready`. */
export class ConnectPresenceCommand {
    constructor(
        public readonly userId: string,
        public readonly socketId: string
    ) {}
}

/** A socket closed. */
export class DisconnectPresenceCommand {
    constructor(
        public readonly userId: string,
        public readonly socketId: string
    ) {}
}

/** A tab's heartbeat, every 30 seconds. */
export class HeartbeatCommand {
    constructor(
        public readonly userId: string,
        public readonly socketId: string
    ) {}
}

/** A tab gone unused for 10 minutes (`idle`), or in use again. */
export class ReportIdleCommand {
    constructor(
        public readonly userId: string,
        public readonly socketId: string,
        public readonly idle: boolean
    ) {}
}

/** Run every 15 seconds (maintenance): the people whose every tab closed or went silent 60 seconds ago go offline. */
export class SweepPresenceCommand {
    constructor(public readonly now: Date) {}
}
