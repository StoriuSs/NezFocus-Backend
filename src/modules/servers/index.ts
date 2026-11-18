/**
 * What other modules may use from servers. Anything not exported here is
 * internal: import it from inside the module only (an ESLint rule enforces
 * this). ServersModule and ServerOwnershipModule themselves are imported
 * from './servers.module'.
 */

// Which servers someone is in, for the realtime module's rooms (SRS 5.2), and since when (D-170).
export {
    MEMBERSHIP,
    type ChannelMemberFilter,
    type MemberSince,
    type Membership,
    type MembershipPort
} from './application/ports/membership.port'
// Presence for the member list and invites: answered by realtime (D-160 pattern).
export { PRESENCE_READER, type MemberPresence, type PresenceReaderPort } from './application/ports/presence-reader.port'
// Which server a channel is in, for the messaging module's permission checks; a server's channels, for realtime's rooms.
export { CHANNEL_DIRECTORY, type ChannelDirectoryPort } from './application/ports/channel-directory.port'
// The roles a message mentions: whether each may be, and their names (D-171).
export { ROLE_DIRECTORY, type DirectoryRole, type RoleDirectoryPort } from './application/ports/role-directory.port'
// Who is in each voice room, for the rooms in GET /servers: answered by voice (D-180 pattern, D-205).
export { ROOM_PEOPLE, type RoomPeoplePort, type RoomPerson } from './application/ports/room-people.port'
// "X joined the server" in the welcome channel: answered by messaging (D-160 pattern, D-180).
export { SYSTEM_MESSAGES, type SystemMessagesPort } from './application/ports/system-messages.port'

// Changes to a server and its members, after the commit: realtime tells the members and moves their sockets (D-178).
export {
    ServerChangedEvent,
    type OwnerTransfer,
    type ServerAction,
    type ServerChange,
    type ServerTopic
} from './application/events/server-changed.event'
export {
    MemberChangedEvent,
    type MemberAction,
    type MemberModeration,
    type RemovedBy
} from './application/events/member-changed.event'
// The messages a ban deletes, which messaging deletes (D-181).
export { type MessageWindow } from './domain/moderation'

// Run on a schedule by src/maintenance.
export { CleanUpServersCommand } from './application/commands/server/server.commands'
