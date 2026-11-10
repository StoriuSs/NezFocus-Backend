import { AccessRole } from '@/modules/permissions'
import { InviteChannelRow, InviteRecord, JoinDecision, JoinFacts } from '../../domain'

/** Who made a link, as the invites page shows them (S-SET-04). */
export type InviteCreator =
    | { state: 'member'; displayName: string | null; username: string | null }
    /** No longer in the server, or the account is deleted: no name (D-81). */
    | { state: 'left' | 'deleted' }

export interface InviteListRow extends InviteRecord {
    creator: InviteCreator
}

/** Everything the public invite page is made from (S-SRV-03). */
export interface InvitePreviewSnapshot {
    invite: InviteRecord
    server: {
        id: string
        name: string
        iconKey: string | null
        ownerId: string
        memberCount: number
        /** Just @everyone: what someone joining holds. */
        roles: AccessRole[]
    }
    /** The creator's name while they are still in the server; null otherwise (D-81). */
    inviterName: string | null
    /** The `?channel=` named, when it is a channel of this server. */
    channel: InviteChannelRow | null
}

export interface InviteRepositoryPort {
    /** Store a new link. False, with nothing written, when the code is taken: draw another. */
    insert(invite: Omit<InviteRecord, 'uses' | 'createdAt'>): Promise<boolean>

    /**
     * Their newest link in a live server with no limit on uses and this
     * lifetime (D-151). Only the newest can be handed out again: an older one
     * of the same lifetime has less time left.
     */
    latestOwnUnlimited(serverId: string, creatorId: string, maxAgeSeconds: number | null): Promise<InviteRecord | null>

    /** The links of a live server that still open, newest first, at most INVITE_LIST_LIMIT (S-SET-04). */
    listLive(serverId: string, now: Date): Promise<InviteListRow[]>

    /** A link of a live server, with what its page shows. Null: no such code, or the server is deleted. */
    preview(code: string, channelId: string | null): Promise<InvitePreviewSnapshot | null>

    /** A link of a live server. Null: no such code, or the server is deleted. */
    find(code: string): Promise<InviteRecord | null>

    /** Revoke: the link stops opening at once. False when it was already gone. */
    delete(code: string): Promise<boolean>

    /**
     * Join a server by a link (REQ-SRV-04), in one transaction:
     * - lock their list of servers (as creating one does), so the count of
     *   100 cannot change before the new membership is written;
     * - read the link and share-lock the live server's row, so a ban or a
     *   deletion of the server (which lock it for update) cannot pass
     *   between reading the facts and writing the member;
     * - let `decide` rule on the facts, at the time read once the locks are
     *   held (it throws to refuse);
     * - to join: count a use only while one is left and the link is in time
     *   (one statement, so two people racing for the last use cannot both
     *   get it: the loser is refused as invalid), then add the member.
     *
     * Lock order, for every transaction taking both: the person's memberships
     * lock first, then the Server row. One taking them the other way round
     * (a ban or an ownership transfer that also adds a membership) could
     * deadlock with a join.
     */
    join(
        code: string,
        userId: string,
        decide: (facts: JoinFacts, now: Date) => JoinDecision
    ): Promise<{ serverId: string; decision: JoinDecision }>
}

/**
 * The most links the invites page lists. Use-limited links are never handed
 * out twice (D-151), so a server can gather many; the newest are the ones a
 * manager looks for.
 */
export const INVITE_LIST_LIMIT = 200

export const INVITE_REPOSITORY = Symbol('InviteRepositoryPort')
