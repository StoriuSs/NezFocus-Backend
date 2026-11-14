/**
 * A tab says its person is typing in a text channel (REQ-MSG-06): sent by
 * the client over its socket, handed on as it came. Typing is the messaging
 * module's (ARCHITECTURE 2.2): it checks the person may post there, holds
 * each tab to once in 8 seconds, and tells the channel `typing.started`.
 */
export class TypingSignalledEvent {
    constructor(
        public readonly userId: string,
        public readonly socketId: string,
        public readonly channelId: string
    ) {}
}
