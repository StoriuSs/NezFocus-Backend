import { MessageCursor } from '../../../domain'

/**
 * The messages inbox items are about, as the items show them now (D-184):
 * notifications' MESSAGE_PREVIEWS asks it through the bus (D-198). Each with
 * its server, for the names of the roles it mentions.
 */
export class ListMessagePreviewsQuery {
    constructor(readonly messages: { id: string; serverId: string }[]) {}
}

/** A page of a channel's history, text or a voice room's chat (SRS 5.1, D-48). */
export class ListMessagesQuery {
    constructor(
        readonly userId: string,
        readonly channelId: string,
        readonly cursor: MessageCursor,
        /** 1-100, checked by the request. */
        readonly limit: number
    ) {}
}
