import { InviteSettings } from '../../../domain'

/*
 * Making, revoking and accepting invite links (REQ-SRV-03, SRV-04, S-SRV-02,
 * S-SRV-03). The rules live in domain/invites.ts, the joining transaction in
 * InviteRepositoryPort.join.
 */

/** A link to hand out: their own again when it may be (D-151), a new one otherwise. */
export class CreateInviteCommand {
    constructor(
        public readonly userId: string,
        public readonly serverId: string,
        public readonly settings: InviteSettings
    ) {}
}

/** Stop a link opening: its creator, or anyone with MANAGE_SERVER. */
export class RevokeInviteCommand {
    constructor(
        public readonly userId: string,
        public readonly code: string
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
