/** A tab says its person is typing in a text channel (REQ-MSG-06): `typing.start` over its socket. */
export class ReportTypingCommand {
    constructor(
        public readonly userId: string,
        public readonly socketId: string,
        public readonly channelId: string
    ) {}
}
