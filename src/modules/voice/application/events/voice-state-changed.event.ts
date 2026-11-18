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
        public readonly joinedAt: Date
    ) {}
}
