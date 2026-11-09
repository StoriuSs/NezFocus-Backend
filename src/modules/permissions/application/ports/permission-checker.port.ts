import { AccessMember, AccessServer } from '../../domain'

export const PERMISSION_CHECKER = Symbol('PERMISSION_CHECKER')
export const PERMISSION_CACHE = Symbol('PERMISSION_CACHE')

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

/**
 * Told by the servers module, after its transaction has committed, what
 * changed. Telling it before the commit would let a reader cache the old rows
 * again under the new version.
 */
export interface PermissionCachePort {
    /** Roles, channels, the owner, or the server itself changed. */
    serverChanged(serverId: string): Promise<void>
    /** A member's roles or timeout changed, or they joined or left. */
    memberChanged(serverId: string, userId: string): Promise<void>
}
