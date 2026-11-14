/** Someone gave an emoji to a message (REQ-MSG-05). */
export class ReactionAddedEvent {
    constructor(
        readonly channelId: string,
        readonly messageId: string,
        readonly emoji: string,
        readonly userId: string
    ) {}
}
