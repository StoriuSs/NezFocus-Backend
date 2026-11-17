import { ChannelViewers } from '@/modules/permissions'

/** A member as the server's lists show them (S-SET-02 tab Members, D-152). */
export interface MemberListItem {
    userId: string
    username: string | null
    displayName: string | null
    /** The stored picture key from the repository; ListMembersHandler turns it into an address. */
    avatarUrl: string | null
    isOwner: boolean
    /** Not @everyone. */
    roleIds: string[]
    joinedAt: Date
    /** As stored: the handler hides one that has run out, and the reason from most viewers (D-154). */
    timeoutUntil: Date | null
    timeoutReason: string | null
}

/**
 * The columns the Members page sorts by (D-89): name; role, ranked by the
 * owner first, then the highest role held, no role last; the day they joined.
 * Presence (D-175): those not offline first (`asc`), then by name; for the
 * people suggested after @.
 */
export const MEMBER_SORTS = ['name', 'role', 'joined_at', 'presence'] as const
export type MemberSort = (typeof MEMBER_SORTS)[number]
export const SORT_ORDERS = ['asc', 'desc'] as const
export type SortOrder = (typeof SORT_ORDERS)[number]
/** The member panel's two groups (D-175): online is anyone not offline to others (away, do not disturb). */
export const PRESENCE_FILTERS = ['online', 'offline'] as const
export type PresenceFilter = (typeof PRESENCE_FILTERS)[number]

export interface MemberSearch {
    /** Display name or username, ignoring case and accents. */
    q: string | null
    /** Only those holding this role. */
    roleId: string | null
    /**
     * Only those this owner may hand the server to (S-SET-07
     * `transfer-picker`, D-161): not themselves, not an account waiting to be
     * deleted. Those timed out stay, shown greyed (D-91).
     */
    transferableFrom: string | null
    /** `asc` is A → Z, lowest role first, oldest first; ties go by name then username, A → Z. */
    sort: MemberSort
    order: SortOrder
    page: number
    limit: number
    /** Only those online, or only those offline, to others now (D-175). */
    presence: PresenceFilter | null
    /** Only those who view a channel (D-192): see channelViewers. */
    viewers: ChannelViewers | null
}

/** What a caller asks of the list; the handler works out `viewers` from a channel. */
export type MemberListing = Omit<MemberSearch, 'viewers'>

export interface MemberRepositoryPort {
    /**
     * One page of the server's members in the order asked (D-89), with how
     * many match in all. `presentIds`: who is not offline to others now
     * (presence), for the presence filter and sort (D-175).
     */
    search(
        serverId: string,
        search: MemberSearch,
        presentIds: string[]
    ): Promise<{ items: MemberListItem[]; total: number }>

    /** How many of the server's members are among `userIds`: an invite's online count (S-SRV-03). */
    countAmong(serverId: string, userIds: string[]): Promise<number>
}

export const MEMBER_REPOSITORY = Symbol('MemberRepositoryPort')
