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

export const PERMISSION_CACHE = Symbol('PermissionCachePort')
