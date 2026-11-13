/**
 * Membership Port — what the servers module tells other modules about who is
 * in which server. The realtime module asks it when a socket connects, to put
 * the socket in the rooms of its servers (SRS 5.2).
 *
 * Only the list: what the person may do in each server is the permissions
 * module's to answer (PERMISSION_CHECKER).
 */
export interface MembershipPort {
    /** The servers, not deleted, that the person is a member of; in no order. */
    serverIdsOf(userId: string): Promise<string[]>
}

export const MEMBERSHIP = Symbol('MembershipPort')
