/** Someone read a channel up to a message (ack, or sending there, D-173): its mention and reply items up to it are read (D-188). */
export class ReadChannelItemsCommand {
    constructor(
        readonly userId: string,
        readonly channelId: string,
        readonly messageId: string
    ) {}
}

/** Someone joined a server (again): their kick and ban items of it are read (D-202). */
export class ReadRemovalItemsCommand {
    constructor(
        readonly userId: string,
        readonly serverId: string
    ) {}
}

/** What "mark read" names in the inbox (SRS 5.1): some items, or every one up to the newest shown. */
export type ReadTarget = { ids: string[] } | { beforeId: string }

/**
 * Marks read in the inbox (REQ-NOTIF-02); gives the unread count after. The
 * channel's own read state stays as it is (D-99).
 */
export class MarkNotificationsReadCommand {
    constructor(
        readonly userId: string,
        readonly target: ReadTarget
    ) {}
}
