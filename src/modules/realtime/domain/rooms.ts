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
 * - `channel:<id>`: every socket whose person may view that channel, open
 *   or not: a text channel's unread count moves too (D-163), a voice room's
 *   list of people with it (D-205).
 */
export const userRoom = (userId: string) => `user:${userId}`
export const sessionRoom = (sessionId: string) => `session:${sessionId}`
export const serverRoom = (serverId: string) => `server:${serverId}`
export const channelRoom = (channelId: string) => `channel:${channelId}`

/** The servers among a socket's rooms (`server:<id>`). */
export const serverIdsIn = (rooms: string[]) =>
    rooms.filter((room) => room.startsWith('server:')).map((room) => room.slice('server:'.length))

/**
 * A member's rooms in one server: the server's, and each channel they may
 * view, text or voice, checked as opening the channel is (VIEW_CHANNEL from
 * channelPermissions: private channels, roles, the owner, a timeout).
 * Decided on the access the caller read; the same rule moves a socket in or
 * out when permissions change (L9).
 */
export function serverRooms(serverId: string, server: AccessServer, member: AccessMember, now: Date): string[] {
    const rooms = [serverRoom(serverId)]
    for (const channel of server.channels) {
        if ((channelPermissions(server, member, channel, now) & Permission.VIEW_CHANNEL) !== 0n) {
            rooms.push(channelRoom(channel.id))
        }
    }
    return rooms
}

/**
 * Where a person's sockets go when their place in a server changes (D-178):
 * into `allowed` (serverRooms; none once they are not in it), and out of the
 * server's room and every room of its channels they are no longer allowed
 * in. Leaving a room one is not in, or joining one again, does nothing.
 */
export function roomMoves(
    serverId: string,
    channelIds: string[],
    allowed: string[]
): { leave: string[]; join: string[] } {
    const kept = new Set(allowed)
    const leave = [serverRoom(serverId), ...channelIds.map(channelRoom)].filter((room) => !kept.has(room))
    return { leave, join: allowed }
}
