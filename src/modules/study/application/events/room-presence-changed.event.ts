/**
 * Who is present in a Room Session changed so that a timer starts (D-215,
 * D-227), published after the commit: someone went away, so their place
 * closes 3 minutes on unless they come back; or nobody is present any
 * more, so the session ends 5 minutes on unless someone comes.
 */
export class RoomPresenceChangedEvent {
    constructor(
        readonly sessionId: string,
        /** The participation that went away, and since when. */
        readonly away: { participationId: string; since: Date } | null,
        /** Since when the room is empty. */
        readonly emptySince: Date | null
    ) {}
}
