/** The pinned messages of a text channel (REQ-MSG-07, S-CHAT-02). */
export class ListPinsQuery {
    constructor(
        readonly userId: string,
        readonly channelId: string
    ) {}
}
