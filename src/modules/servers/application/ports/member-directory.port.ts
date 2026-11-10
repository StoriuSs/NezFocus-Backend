/** A member as the server's lists show them (S-SET-02 tab Members, D-152). */
export interface MemberListItem {
    userId: string
    username: string | null
    displayName: string | null
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
 */
export const MEMBER_SORTS = ['name', 'role', 'joined_at'] as const
export type MemberSort = (typeof MEMBER_SORTS)[number]
export const SORT_ORDERS = ['asc', 'desc'] as const
export type SortOrder = (typeof SORT_ORDERS)[number]

export interface MemberSearch {
    /** Display name or username, ignoring case and accents. */
    q: string | null
    /** Only those holding this role. */
    roleId: string | null
    /** `asc` is A → Z, lowest role first, oldest first; ties go by name then username, A → Z. */
    sort: MemberSort
    order: SortOrder
    page: number
    limit: number
}

export interface MemberDirectoryPort {
    /**
     * One page of the server's members in the order asked (D-89), with how
     * many match in all.
     */
    search(serverId: string, search: MemberSearch): Promise<{ items: MemberListItem[]; total: number }>
}

export const MEMBER_DIRECTORY = Symbol('MemberDirectoryPort')
