import { MessageCursor } from '../../../domain'

/** A page of a text channel's history (SRS 5.1, D-48). */
export class ListMessagesQuery {
    constructor(
        readonly userId: string,
        readonly channelId: string,
        readonly cursor: MessageCursor,
        /** 1-100, checked by the request. */
        readonly limit: number
    ) {}
}
