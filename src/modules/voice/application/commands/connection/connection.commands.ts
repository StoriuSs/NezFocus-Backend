/*
 * A person's own connection to voice rooms (REQ-VC-01, VC-02): a token to
 * join one ("Vào phòng"), and leaving.
 */

/** A token to join a voice room, putting them out of any other first (one connection per account, D-210). */
export class IssueJoinTokenCommand {
    constructor(
        public readonly userId: string,
        public readonly channelId: string,
        /** The sign-in session asking: its end puts the connection out (D-214). */
        public readonly sessionId: string
    ) {}
}

/** Leave the room they are in, if any ("Rời phòng"). */
export class LeaveVoiceCommand {
    constructor(public readonly userId: string) {}
}
