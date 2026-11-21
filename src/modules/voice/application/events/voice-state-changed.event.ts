/**
 * Someone came into a voice room, went out of it, or their icons changed
 * (D-205), after the commit. Voice tells the room's viewers the whole list
 * again (`voice_state.updated`); study hears when people join and leave its
 * rooms (M5).
 *
 * A move from one room to another is `left` there, then `joined` here. A
 * reload in the same room is `joined` again, with no `left` before: the new
 * connection replaced the old one.
 */
export class VoiceStateChangedEvent {
    constructor(
        public readonly channelId: string,
        public readonly userId: string,
        public readonly change: 'joined' | 'left' | 'updated',
        /** When the connection this is about joined. */
        public readonly joinedAt: Date,
        /**
         * A `left` because the connection was lost, as LiveKit tells it (its
         * participant_left, or the reconciliation no longer finding them):
         * a reload, a closed tab, the network gone. Study keeps their place
         * 3 minutes (D-215). False for every leaving someone meant or was
         * made to: Rời, another room, signing out, put out.
         */
        public readonly lost = false
    ) {}
}
