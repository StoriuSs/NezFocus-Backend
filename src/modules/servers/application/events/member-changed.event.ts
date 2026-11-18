import type { MessageWindow } from '../../domain'

/** What happened to one member; each with its socket event (`member.joined`, SRS 5.2). */
export type MemberAction = 'joined' | 'updated' | 'left'

/** Who took someone out of a server: none when they left by themselves. */
export type RemovedBy = 'kick' | 'ban'

/**
 * A kick, ban or timeout (a new length too) the person hears of in their
 * inbox (REQ-ROLE-04, D-188): the server's name then, why, and when a
 * timeout ends. Never who did it. None for a timeout ended early.
 */
export interface MemberModeration {
    action: 'kick' | 'ban' | 'timeout'
    serverName: string
    reason: string | null
    timeoutUntil: Date | null
}

/**
 * Domain Event: Member Changed
 *
 * Published after the commit when someone joins a server (by a link, or by
 * making it), when a member is given or loses a role or a timeout, and when
 * they leave it, by themselves, kicked or banned, or as a deleted account.
 * The realtime module moves that person's sockets into or out of the
 * server's rooms and tells the server (D-178); the one who left hears it
 * first, alone, with who removed them and why (S-MOD-02), which the others
 * never hear. A ban that deletes their recent messages says which: the
 * messaging module deletes them (D-181). A kick, ban or timeout says what
 * the person's inbox item keeps (`moderation`).
 */
export class MemberChangedEvent {
    constructor(
        public readonly serverId: string,
        public readonly userId: string,
        public readonly action: MemberAction,
        public readonly removedBy: RemovedBy | null = null,
        public readonly reason: string | null = null,
        public readonly deleteMessages: MessageWindow | null = null,
        public readonly moderation: MemberModeration | null = null
    ) {}
}
