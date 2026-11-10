import { InviteSettings } from '../../domain'

/*
 * Invite links (REQ-SRV-03, SRV-04, S-SRV-02, S-SRV-03, S-SET-04). Kept
 * together, as the channel list's changes are: the rules all live in
 * domain/invites.ts, the joining transaction in InviteRepositoryPort.join.
 */

/** A link to hand out: their own again when it may be (D-151), a new one otherwise. */
export class CreateInviteCommand {
    constructor(
        public readonly userId: string,
        public readonly serverId: string,
        public readonly settings: InviteSettings
    ) {}
}

/** The links of a server that still open (MANAGE_SERVER). */
export class ListInvitesQuery {
    constructor(
        public readonly userId: string,
        public readonly serverId: string
    ) {}
}

/** Stop a link opening: its creator, or anyone with MANAGE_SERVER. */
export class RevokeInviteCommand {
    constructor(
        public readonly userId: string,
        public readonly code: string
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

/** Join the server a link leads to. */
export class AcceptInviteCommand {
    constructor(
        public readonly userId: string,
        public readonly code: string,
        public readonly ip: string
    ) {}
}
