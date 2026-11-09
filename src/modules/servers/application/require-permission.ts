import { PermissionCheckerPort, PermissionName, Permission, serverPermissions } from '@/modules/permissions'
import { MissingPermissionError, ServerNotFoundError } from '../domain'

/**
 * Pass only a member of the live server holding `permission` server-wide.
 * Anyone else learns nothing more than "not found" (NFR-SEC-05); a member
 * without it gets FORBIDDEN_ERROR.
 *
 * Reads the permission cache, so it suits actions whose outcome does not
 * depend on the hierarchy (an icon, a name). Writes that change roles,
 * members or channels lock the server row and decide on what they read there.
 */
export async function requireServerPermission(
    checker: PermissionCheckerPort,
    serverId: string,
    userId: string,
    permission: PermissionName
): Promise<void> {
    const access = await checker.access(serverId, userId)
    if (!access) throw new ServerNotFoundError(serverId)
    const granted = serverPermissions(access.server, access.member, new Date())
    if ((granted & Permission[permission]) === 0n) throw new MissingPermissionError(permission)
}
