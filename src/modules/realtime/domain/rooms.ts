import { AccessMember, AccessServer, channelPermissions, Permission } from '@/modules/permissions'

/**
 * The socket.io rooms events go to (SRS 5.2, ARCHITECTURE 3.1 and 3.2). A
 * socket is put in its rooms when it connects, never by asking.
 *
 * - `user:<id>`: every socket of one person; private events.
 * - `session:<id>`: the sockets of one signed-in session, to cut them off
 *   when it ends (`session.revoked`).
 * - `server:<id>`: every member's sockets; events about the server itself,
 *   its members, roles and channels.
 * - `channel:<id>`: every socket whose person may view that text channel,
 *   open or not, so its unread count moves too (D-163).
 */
export const userRoom = (userId: string) => `user:${userId}`
export const sessionRoom = (sessionId: string) => `session:${sessionId}`
export const serverRoom = (serverId: string) => `server:${serverId}`
export const channelRoom = (channelId: string) => `channel:${channelId}`

/**
 * A member's rooms in one server: the server's, and each text channel they
 * may view, checked as opening the channel is (VIEW_CHANNEL from
 * channelPermissions: private channels, roles, the owner, a timeout). Voice
 * rooms have no chat yet (M4). Decided on the access the caller read; the
 * same rule moves a socket in or out when permissions change (L9).
 */
export function serverRooms(serverId: string, server: AccessServer, member: AccessMember, now: Date): string[] {
    const rooms = [serverRoom(serverId)]
    for (const channel of server.channels) {
        if (channel.type !== 'text') continue
        if ((channelPermissions(server, member, channel, now) & Permission.VIEW_CHANNEL) !== 0n) {
            rooms.push(channelRoom(channel.id))
        }
    }
    return rooms
}
