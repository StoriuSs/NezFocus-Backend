/**
 * What other modules may use from permissions. PermissionsModule itself is
 * imported from './permissions.module'.
 */

// Ask what someone may do in a server; report what changed after a commit.
export {
    PERMISSION_CACHE,
    PERMISSION_CHECKER,
    PermissionCachePort,
    PermissionCheckerPort,
    ServerAccess
} from './application/ports/permission-checker.port'

// The bits (SRS appendix B) and the rules that combine them. Pure functions:
// a write that must decide on fresh, locked rows calls them on its own data.
export * from './domain'
