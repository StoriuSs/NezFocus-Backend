/**
 * What other modules may use from permissions. PermissionsModule itself is
 * imported from './permissions.module'.
 */

// Ask what someone may do in a server; report what changed after a commit.
export { PERMISSION_CHECKER, PermissionCheckerPort, ServerAccess } from './application/ports/permission-checker.port'
export { PERMISSION_CACHE, PermissionCachePort } from './application/ports/permission-cache.port'

// The bits (SRS appendix B) and the rules that combine them. Pure functions:
// a write that must decide on fresh, locked rows calls them on its own data.
export * from './domain'
