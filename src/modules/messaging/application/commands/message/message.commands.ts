/** Send a message to a text channel (REQ-MSG-01), maybe answering another (REQ-MSG-05). */
export class SendMessageCommand {
    constructor(
        readonly userId: string,
        readonly channelId: string,
        /** As typed: the handler drops the blank around it. */
        readonly content: string,
        /** Chosen by the client for this message, kept across its retries (REQ-MSG-10). */
        readonly nonce: string,
        /** The message it answers: a regular one of the same channel, deleted or not. */
        readonly replyToId: string | null = null
    ) {}
}

/** Change the text of one's own message (REQ-MSG-05). */
export class EditMessageCommand {
    constructor(
        readonly userId: string,
        readonly messageId: string,
        /** Normalised and checked by the request, like a new message's. */
        readonly content: string
    ) {}
}

/** Delete one's own message, or anyone's with MANAGE_MESSAGES (REQ-MSG-05). */
export class DeleteMessageCommand {
    constructor(
        readonly userId: string,
        readonly messageId: string
    ) {}
}
