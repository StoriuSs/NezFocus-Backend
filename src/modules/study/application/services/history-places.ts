import { channelPermissions, Permission, PermissionCheckerPort, ServerAccess } from '@/modules/permissions'
import { ChannelDirectoryPort } from '@/modules/servers'
import { HistoryRow } from '../../domain'

/**
 * Where a line of the history was, as its person may know it now (D-230):
 * a room they view, by name with its server's; a room deleted, said so with
 * the server's name; a room they no longer view, only the server's name; a
 * server they are no longer in, or deleted, no name at all. Nulls for a Solo.
 */
export interface HistoryPlace {
    roomName: string | null
    roomDeleted: boolean
    serverName: string | null
}

const NO_PLACE: HistoryPlace = { roomName: null, roomDeleted: false, serverName: null }

/** What naming the lines reads: the names, and where the person stands in each server now. */
export interface PlaceSources {
    channels: ChannelDirectoryPort
    checker: PermissionCheckerPort
}

/**
 * The place of each line, by session id. Each server's access is read once
 * from the permission cache (D-146), the names in one read.
 */
export async function historyPlaces(
    { channels, checker }: PlaceSources,
    userId: string,
    rows: HistoryRow[],
    now: Date
): Promise<Map<string, HistoryPlace>> {
    const rooms = rows.filter((row) => row.serverId !== null && row.channelId !== null)
    const serverIds = [...new Set(rooms.map((row) => row.serverId!))]
    const [names, accesses] = await Promise.all([
        channels.namesOf(
            serverIds,
            rooms.map((row) => row.channelId!)
        ),
        Promise.all(serverIds.map(async (serverId) => [serverId, await checker.access(serverId, userId)] as const))
    ])
    const accessOf = new Map<string, ServerAccess | null>(accesses)

    const places = new Map<string, HistoryPlace>()
    for (const row of rows) places.set(row.sessionId, NO_PLACE)
    for (const row of rooms) {
        const access = accessOf.get(row.serverId!)
        const serverName = names.servers.get(row.serverId!)
        if (!access || serverName === undefined) continue
        const roomName = names.channels.get(row.channelId!)
        if (roomName === undefined) {
            places.set(row.sessionId, { roomName: null, roomDeleted: true, serverName })
            continue
        }
        const channel = access.server.channels.find((candidate) => candidate.id === row.channelId)
        const views =
            channel !== undefined &&
            (channelPermissions(access.server, access.member, channel, now) & Permission.VIEW_CHANNEL) !== 0n
        places.set(row.sessionId, { roomName: views ? roomName : null, roomDeleted: false, serverName })
    }
    return places
}
