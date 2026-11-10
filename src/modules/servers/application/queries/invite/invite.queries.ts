/*
 * Reading invite links: a server's live ones (S-SET-04) and the public invite
 * page (S-SRV-03). The rules of what shows live in domain/invites.ts.
 */

/** The links of a server that still open (MANAGE_SERVER). */
export class ListInvitesQuery {
    constructor(
        public readonly userId: string,
        public readonly serverId: string
    ) {}
}

/** The public invite page; `ip` counts wrong codes per network. */
export class PreviewInviteQuery {
    constructor(
        public readonly code: string,
        public readonly channelId: string | null,
        public readonly ip: string
    ) {}
}
