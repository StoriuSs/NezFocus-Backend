import { AccessMember, AccessServer } from '../../domain'

/** What a check in one server needs: hand both to the functions in domain/access. */
export interface ServerAccess {
    server: AccessServer
    member: AccessMember
}

/**
 * The one way other modules learn what someone may do in a server
 * (REQ-ROLE-05). Fast: answered from the cache when it can be (D-146).
 *
 * For reads and for actions where a second-old answer is acceptable. A write
 * that changes roles, members or channels decides from data it reads and locks
 * inside its own transaction instead, so two such writes cannot both pass on
 * the same snapshot.
 */
export interface PermissionCheckerPort {
    /**
     * Null when the server does not exist, was deleted, or the person is not
     * a member: answer NOT_FOUND, never saying which (NFR-SEC-05).
     */
    access(serverId: string, userId: string): Promise<ServerAccess | null>
}

export const PERMISSION_CHECKER = Symbol('PermissionCheckerPort')
