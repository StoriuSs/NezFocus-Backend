import { ModerationState, ModerationWrite } from '../../domain'

/** Someone as the ban list names them; names are null once their account is deleted. */
export interface BanPerson {
    userId: string
    username: string | null
    displayName: string | null
    avatarUrl: string | null
}

/** A row of the ban list (S-SET-04 `bans`). */
export interface BanListItem {
    user: BanPerson
    reason: string | null
    createdAt: Date
    /** Null when that account is gone for good. */
    bannedBy: BanPerson | null
}

export interface ModerationRepositoryPort {
    /**
     * One kick, ban, unban or timeout (REQ-ROLE-04). In one transaction: lock
     * the live server's row (the lock joining through an invite waits for),
     * read the server, the person acting, the one named (when in the server)
     * and whether that one is banned, let `decide` turn that into writes (or
     * throw), and carry them out.
     *
     * False, with nothing written, when the server is gone or they are not in it.
     */
    change(
        serverId: string,
        userId: string,
        targetId: string,
        decide: (state: ModerationState) => ModerationWrite[]
    ): Promise<boolean>

    /** One page of the bans, newest first (SRS 5.1), with how many there are. */
    bans(serverId: string, page: number, limit: number): Promise<{ items: BanListItem[]; total: number }>
}

export const MODERATION_REPOSITORY = Symbol('ModerationRepositoryPort')
