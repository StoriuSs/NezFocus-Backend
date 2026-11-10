/*
 * Kick, ban, unban and timeout (REQ-ROLE-04, S-SET-03, S-SET-04). The rules
 * live in domain/moderation.ts; each change runs in
 * ModerationRepositoryPort.change, under the server row's lock.
 */

export class KickMemberCommand {
    constructor(
        public readonly userId: string,
        public readonly serverId: string,
        public readonly targetId: string,
        public readonly reason: string | null
    ) {}
}

export class BanMemberCommand {
    constructor(
        public readonly userId: string,
        public readonly serverId: string,
        public readonly targetId: string,
        public readonly reason: string | null
    ) {}
}

export class UnbanMemberCommand {
    constructor(
        public readonly userId: string,
        public readonly serverId: string,
        public readonly targetId: string
    ) {}
}

/** One of the six lengths, from now; null ends the timeout. */
export class TimeoutMemberCommand {
    constructor(
        public readonly userId: string,
        public readonly serverId: string,
        public readonly targetId: string,
        public readonly seconds: number | null,
        public readonly reason: string | null
    ) {}
}
