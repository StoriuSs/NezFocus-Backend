/** One server someone is in, and since when (D-170: where their unread starts). */
export interface Membership {
    serverId: string
    joinedAt: Date
}

/**
 * Membership Port — what the servers module tells other modules about who is
 * in which server. The realtime module asks it when a socket connects, to put
 * the socket in the rooms of its servers (SRS 5.2); the messaging module, for
 * where someone's unread messages start (D-170).
 *
 * Only the list: what the person may do in each server is the permissions
 * module's to answer (PERMISSION_CHECKER).
 */
export interface MembershipPort {
    /** The servers, not deleted, that the person is a member of; in no order. */
    serverIdsOf(userId: string): Promise<string[]>

    /** The same servers, each with when the person joined it (the latest time, after leaving and coming back). */
    membershipsOf(userId: string): Promise<Membership[]>

    /** Those of `userIds` who are members of the server, in no order: one read, however many are asked about (@here). */
    membersAmong(serverId: string, userIds: string[]): Promise<string[]>
}

export const MEMBERSHIP = Symbol('MembershipPort')
