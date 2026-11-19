import { PermissionCheckerPort } from '@/modules/permissions'
import { voiceRoomOf } from '../../domain'
import { putOut, PutOutSources } from './leave-room'
import { mutedSources, RoomStanding, standingIn } from './room-access'

/** What setting someone's place in a room right needs. */
export interface RecheckSources extends PutOutSources {
    checker: PermissionCheckerPort
}

/**
 * Where `userId` stands in room `channelId` now (D-210, D-212): in, sending
 * what their permissions allow; or to be put out, and why. `serverId` null:
 * the room's channel is gone, deleted or in a deleted server. One no longer
 * a member of the server is out as `server_left`.
 */
export async function standingOf(
    checker: PermissionCheckerPort,
    serverId: string | null,
    channelId: string,
    userId: string,
    now: Date
): Promise<RoomStanding> {
    if (!serverId) return { kind: 'out', reason: 'channel_deleted' }
    const access = await checker.access(serverId, userId)
    if (!access) return { kind: 'out', reason: 'server_left' }
    return standingIn(access, channelId, now)
}

/**
 * Someone in room `channelId` of server `serverId` (null: gone), set right
 * as the server is now (D-210, D-212): put out and told why once they may no
 * longer be there (timed out, CONNECT or the view of it lost, the room
 * gone); else LiveKit is told what they may send, which SPEAK or VIDEO lost
 * or gained changes without putting them out, a moderator's mute kept.
 * Every time, changed or not: cheaper than remembering what each was given.
 *
 * In the person's media turn, the row and the permissions read once it is
 * held: a moderator's mute in between is kept, not undone by a recheck that
 * read the row before it. Someone who left the room meanwhile is left
 * alone. One no longer a member is left to the MemberChangedEvent of their
 * leaving, which says why.
 *
 * True when they are still in.
 */
export async function recheckOccupant(
    sources: RecheckSources,
    serverId: string | null,
    { userId, channelId }: { userId: string; channelId: string },
    now: Date
): Promise<boolean> {
    return sources.states.inMediaTurn(userId, async () => {
        const current = await sources.states.find(userId)
        if (current?.channelId !== channelId) return false
        const standing = await standingOf(sources.checker, serverId, channelId, userId, now)
        if (standing.kind === 'out') {
            if (standing.reason !== 'server_left') await putOut(sources, current, standing.reason)
            return false
        }
        await sources.media.setSources(voiceRoomOf(channelId), userId, mutedSources(standing.sources, current.modMuted))
        return true
    })
}

/** What emptying the rooms of deleted channels needs. */
export type GoneRoomSources = Pick<RecheckSources, 'media' | 'publisher'>

/**
 * Puts everyone still connected to these rooms out, their channels gone,
 * deleted or in a deleted server, telling each `channel_deleted` (D-212). A
 * deleted channel takes its rows with it (the cascade), so only LiveKit
 * still knows who was in it. Told only when LiveKit had them: two runs at
 * once tell each person once.
 */
export async function clearGoneRooms(sources: GoneRoomSources, channelIds: string[]): Promise<void> {
    for (const channelId of channelIds) {
        const room = voiceRoomOf(channelId)
        for (const { identity } of await sources.media.listParticipants(room)) {
            if (await sources.media.removeParticipant(room, identity)) {
                sources.publisher.toUser(identity, 'voice.disconnected', { channelId, reason: 'channel_deleted' })
            }
        }
    }
}
