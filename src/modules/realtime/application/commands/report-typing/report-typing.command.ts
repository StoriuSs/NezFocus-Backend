/** A tab says its person is typing in a channel, text or a voice room's chat (REQ-MSG-06): `typing.start` over its socket. */
export class ReportTypingCommand {
    constructor(
        public readonly userId: string,
        public readonly socketId: string,
        public readonly channelId: string
    ) {}
}
