/** Pin a message of a channel (REQ-MSG-07); pinning it again changes nothing. */
export class PinMessageCommand {
    constructor(
        readonly userId: string,
        readonly channelId: string,
        readonly messageId: string
    ) {}
}

/** Unpin a message of a channel (REQ-MSG-07). */
export class UnpinMessageCommand {
    constructor(
        readonly userId: string,
        readonly channelId: string,
        readonly messageId: string
    ) {}
}
