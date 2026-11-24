/*
 * Reads of direct messages (REQ-SOCIAL-04, D-238, D-244): my list and one
 * DM of it, and what other modules ask through ports answered here
 * (messaging's DM_ACCESS, realtime's DM_CHANNELS).
 */

/** My DMs shown in my list, the latest active first (`GET /me/dms`, D-244). */
export class ListMyDmsQuery {
    constructor(readonly userId: string) {}
}

/** One DM of mine as the list shows it, for the answer to opening it (D-159) and its events; null when not mine. */
export class GetDmQuery {
    constructor(
        readonly userId: string,
        readonly channelId: string
    ) {}
}

/** A DM's two people and when it began; null when the channel is no DM (DM_ACCESS). */
export class GetDmConversationQuery {
    constructor(readonly channelId: string) {}
}

/** Whether one of a DM's two may message the other now (DM_ACCESS, REQ-SOCIAL-04). */
export class CanMessageInDmQuery {
    constructor(
        readonly userId: string,
        readonly channelId: string
    ) {}
}

/** A person's DMs shown in their list, for their unread (DM_ACCESS, D-244). */
export class ListShownDmsQuery {
    constructor(readonly userId: string) {}
}

/** The channel ids of every DM of a person, whose rooms their sockets join (DM_CHANNELS). */
export class ListDmChannelIdsQuery {
    constructor(readonly userId: string) {}
}
