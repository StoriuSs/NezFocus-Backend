import { AccessMember, AccessServer } from '../../domain'

export const ACCESS_SOURCE = Symbol('ACCESS_SOURCE')

/**
 * Where the facts a permission depends on are read from: the database, the
 * record of truth. The cache sits in front of it (PermissionCheckerPort).
 */
export interface AccessSourcePort {
    /** Null: no such server, or it was deleted. Read as one snapshot. */
    loadServer(serverId: string): Promise<AccessServer | null>
    /** Null: the person is not a member of that server. */
    loadMember(serverId: string, userId: string): Promise<AccessMember | null>
}
