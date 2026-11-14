/**
 * Mark a channel read up to a message of it (REQ-MSG-09): the newest one
 * the client has seen (D-46), or the channel's newest when none is named
 * ("Mark as read").
 */
export class AckChannelCommand {
    constructor(
        readonly userId: string,
        readonly channelId: string,
        readonly messageId: string | null
    ) {}
}
