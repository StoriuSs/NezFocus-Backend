import { channelPermissions, Permission, PermissionCheckerPort } from '@/modules/permissions'
import { ChannelDirectoryPort } from '@/modules/servers'
import { CannotConnectError, VoiceRoomNotFoundError, VoiceTimedOutError } from '../../domain'
import { MediaSource } from '../ports'

/** What opening a room reads: where a channel is, and what someone may do there. */
export interface RoomSources {
    channels: ChannelDirectoryPort
    checker: PermissionCheckerPort
}

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
    const channel = access?.server.channels.find((candidate) => candidate.id === channelId)
    if (!access || channel?.type !== 'voice') throw new VoiceRoomNotFoundError(channelId)

    const permissions = channelPermissions(access.server, access.member, channel, now)
    if ((permissions & Permission.VIEW_CHANNEL) === 0n) throw new VoiceRoomNotFoundError(channelId)
    if ((permissions & Permission.CONNECT) === 0n) {
        // A timeout leaves only VIEW_CHANNEL (appendix B, step 6); the owner
        // and ADMINISTRATOR keep CONNECT through one, so never reach here.
        const { timeoutUntil } = access.member
        if (timeoutUntil && timeoutUntil.getTime() > now.getTime()) throw new VoiceTimedOutError(timeoutUntil)
        throw new CannotConnectError()
    }

    const sources: MediaSource[] = []
    if ((permissions & Permission.SPEAK) !== 0n) sources.push('microphone')
    if ((permissions & Permission.VIDEO) !== 0n) sources.push('camera', 'screen_share', 'screen_share_audio')
    return { serverId, sources }
}
