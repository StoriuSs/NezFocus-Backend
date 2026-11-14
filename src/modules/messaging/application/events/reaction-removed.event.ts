/** Someone took their emoji off a message (REQ-MSG-05). */
export class ReactionRemovedEvent {
    constructor(
        readonly channelId: string,
        readonly messageId: string,
        readonly emoji: string,
        readonly userId: string
    ) {}
}
