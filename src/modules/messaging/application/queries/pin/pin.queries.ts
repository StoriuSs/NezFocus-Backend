/** The pinned messages of a text channel (REQ-MSG-07, S-CHAT-02; a voice room's chat has none, D-213). */
export class ListPinsQuery {
    constructor(
        readonly userId: string,
        readonly channelId: string
    ) {}
}
