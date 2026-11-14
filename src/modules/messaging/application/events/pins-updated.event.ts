/** A message of the channel was pinned or unpinned (REQ-MSG-07). */
export class PinsUpdatedEvent {
    constructor(
        readonly channelId: string,
        readonly messageId: string,
        readonly pinned: boolean
    ) {}
}
