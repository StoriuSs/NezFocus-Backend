/** Send a message to a text channel (REQ-MSG-01). */
export class SendMessageCommand {
    constructor(
        readonly userId: string,
        readonly channelId: string,
        /** As typed: the handler drops the blank around it. */
        readonly content: string,
        /** Chosen by the client for this message, kept across its retries (REQ-MSG-10). */
        readonly nonce: string
    ) {}
}
