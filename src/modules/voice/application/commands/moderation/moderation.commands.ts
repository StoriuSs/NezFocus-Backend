/** A moderator turning off someone's microphone in a voice room (REQ-VC-04, D-207): MUTE_MEMBERS. */
export class MuteParticipantCommand {
    constructor(
        public readonly actorId: string,
        public readonly channelId: string,
        public readonly targetId: string
    ) {}
}

/** A moderator letting someone they muted speak again (D-207): MUTE_MEMBERS. */
export class UnmuteParticipantCommand {
    constructor(
        public readonly actorId: string,
        public readonly channelId: string,
        public readonly targetId: string
    ) {}
}

/** A moderator putting someone out of a voice room (REQ-VC-04): MOVE_MEMBERS; they may join again at once. */
export class DisconnectParticipantCommand {
    constructor(
        public readonly actorId: string,
        public readonly channelId: string,
        public readonly targetId: string
    ) {}
}
