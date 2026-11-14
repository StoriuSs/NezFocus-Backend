/**
 * What other modules may use from servers. Anything not exported here is
 * internal: import it from inside the module only (an ESLint rule enforces
 * this). ServersModule and ServerOwnershipModule themselves are imported
 * from './servers.module'.
 */

// Which servers someone is in, for the realtime module's rooms (SRS 5.2).
export { MEMBERSHIP, type MembershipPort } from './application/ports/membership.port'
// Which server a channel is in, for the messaging module's permission checks.
export { CHANNEL_DIRECTORY, type ChannelDirectoryPort } from './application/ports/channel-directory.port'
// The roles a message mentions: whether each may be, and their names (D-171).
export { ROLE_DIRECTORY, type DirectoryRole, type RoleDirectoryPort } from './application/ports/role-directory.port'

// Run on a schedule by src/maintenance.
export { CleanUpServersCommand } from './application/commands/server/server.commands'
