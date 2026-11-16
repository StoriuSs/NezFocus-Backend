import type { MessageWindow } from '../../domain'

/** What happened to one member; each with its socket event (`member.joined`, SRS 5.2). */
export type MemberAction = 'joined' | 'updated' | 'left'

/** Who took someone out of a server: none when they left by themselves. */
export type RemovedBy = 'kick' | 'ban'

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
 * messaging module deletes them (D-181).
 */
export class MemberChangedEvent {
    constructor(
        public readonly serverId: string,
        public readonly userId: string,
        public readonly action: MemberAction,
        public readonly removedBy: RemovedBy | null = null,
        public readonly reason: string | null = null,
        public readonly deleteMessages: MessageWindow | null = null
    ) {}
}
