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
}

export interface MemberSearch {
    /** Display name or username, ignoring case and accents. */
    q: string | null
    /** Only those holding this role. */
    roleId: string | null
    page: number
    limit: number
}

export interface MemberDirectoryPort {
    /**
     * One page of the server's members, by name then username (D-89), with
     * how many match in all.
     */
    search(serverId: string, search: MemberSearch): Promise<{ items: MemberListItem[]; total: number }>
}

export const MEMBER_DIRECTORY = Symbol('MemberDirectoryPort')
