/** A message was deleted (REQ-MSG-05): its row stays for the replies to it, not its place in the history. */
export class MessageDeletedEvent {
    constructor(
        readonly messageId: string,
        readonly channelId: string
    ) {}
}
