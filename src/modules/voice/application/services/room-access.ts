import {
    AccessChannel,
    channelPermissions,
    Permission,
    PermissionCheckerPort,
    ServerAccess
} from '@/modules/permissions'
import { ChannelDirectoryPort } from '@/modules/servers'
import { CannotConnectError, DisconnectReason, VoiceRoomNotFoundError, VoiceTimedOutError } from '../../domain'
import { MediaSource } from '../ports'

/** What opening a room reads: where a channel is, and what someone may do there. */
export interface RoomSources {
    channels: ChannelDirectoryPort
    checker: PermissionCheckerPort
}

/** What SPEAK and VIDEO let someone send (D-210): the microphone; the camera and the screen with its sound. */
export function sourcesOf(permissions: bigint): MediaSource[] {
    const sources: MediaSource[] = []
    if ((permissions & Permission.SPEAK) !== 0n) sources.push('microphone')
    if ((permissions & Permission.VIDEO) !== 0n) sources.push('camera', 'screen_share', 'screen_share_audio')
    return sources
}

/** What someone muted by a moderator may send: all but the microphone (D-207, D-212). */
export const mutedSources = (sources: MediaSource[], modMuted: boolean): MediaSource[] =>
    modMuted ? sources.filter((source) => source !== 'microphone') : sources

/** Whether a timeout still runs at `now`. */
export const timedOut = ({ member }: ServerAccess, now: Date): boolean =>
    member.timeoutUntil !== null && member.timeoutUntil.getTime() > now.getTime()

/** The voice channel `channelId` of the server, if it has one by that id. */
export const voiceChannelOf = ({ server }: ServerAccess, channelId: string): AccessChannel | undefined =>
    server.channels.find((candidate) => candidate.id === channelId && candidate.type === 'voice')

/**
 * The voice room `channelId` as `userId` may join it now (REQ-VC-01), and
 * what they may send there (D-210): SPEAK the microphone, VIDEO the camera
 * and the screen with its sound. Anyone who may not view it learns only "not
 * found" (NFR-SEC-05), as for a text channel; a timeout says until when
 * (MEMBER_TIMED_OUT); no CONNECT is FORBIDDEN.
 *
 * Reads the permission cache: a role changed a moment ago reaches it once
 * servers has told the cache (D-146).
 */
export async function openRoom(
    { channels, checker }: RoomSources,
    channelId: string,
    userId: string,
    now: Date
): Promise<{ serverId: string; sources: MediaSource[] }> {
    const serverId = await channels.serverIdOf(channelId)
    if (!serverId) throw new VoiceRoomNotFoundError(channelId)
    const access = await checker.access(serverId, userId)
    const channel = access && voiceChannelOf(access, channelId)
    if (!access || !channel) throw new VoiceRoomNotFoundError(channelId)

    const permissions = channelPermissions(access.server, access.member, channel, now)
    if ((permissions & Permission.VIEW_CHANNEL) === 0n) throw new VoiceRoomNotFoundError(channelId)
    if ((permissions & Permission.CONNECT) === 0n) {
        // A timeout leaves only VIEW_CHANNEL (appendix B, step 6); the owner
        // and ADMINISTRATOR keep CONNECT through one, so never reach here.
        if (timedOut(access, now)) throw new VoiceTimedOutError(access.member.timeoutUntil as Date)
        throw new CannotConnectError()
    }
    return { serverId, sources: sourcesOf(permissions) }
}

/**
 * Where someone already in room `channelId` stands now that their server
 * changed (D-210, D-212): still let in, sending what their permissions
 * allow; or to be put out, and why. A channel gone is the room gone.
 */
export type RoomStanding = { kind: 'in'; sources: MediaSource[] } | { kind: 'out'; reason: DisconnectReason }

export function standingIn(access: ServerAccess, channelId: string, now: Date): RoomStanding {
    const channel = voiceChannelOf(access, channelId)
    if (!channel) return { kind: 'out', reason: 'channel_deleted' }
    const permissions = channelPermissions(access.server, access.member, channel, now)
    if ((permissions & Permission.VIEW_CHANNEL) === 0n || (permissions & Permission.CONNECT) === 0n) {
        return { kind: 'out', reason: timedOut(access, now) ? 'timeout' : 'permission' }
    }
    return { kind: 'in', sources: sourcesOf(permissions) }
}

/**
 * The server of each of these channels, read at once; a channel gone, or in
 * a deleted server, is not in the map. One read per channel, side by side:
 * the rooms with people in them are few.
 */
export async function serversOf(channels: ChannelDirectoryPort, channelIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(channelIds)]
    const found = await Promise.all(ids.map(async (id) => [id, await channels.serverIdOf(id)] as const))
    return new Map(found.filter((entry): entry is readonly [string, string] => entry[1] !== null))
}
