/**
 * Post "<who> joined the server" in its welcome channel (REQ-SRV-01, D-83):
 * sent by servers through the SYSTEM_MESSAGES adapter (D-180), never by a route.
 */
export class PostMemberJoinedCommand {
    constructor(
        readonly serverId: string,
        readonly userId: string,
        readonly channelId: string
    ) {}
}
