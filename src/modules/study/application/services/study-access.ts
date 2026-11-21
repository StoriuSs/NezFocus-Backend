import { channelPermissions, Permission, PermissionCheckerPort } from '@/modules/permissions'
import { ChannelDirectoryPort, StudyRoomSettings } from '@/modules/servers'
import { StudyRoomNotFoundError, StudyTimedOutError } from '../../domain'

/** What deciding who may start or control a session reads. */
export interface StudyAccessSources {
    channels: ChannelDirectoryPort
    checker: PermissionCheckerPort
}

/** A study room as someone who may see it stands in it. */
export interface StudyStanding {
    room: StudyRoomSettings
    /** MANAGE_STUDY_ROOMS in this room: controls every session of it (REQ-STUDY-03). */
    managesStudyRooms: boolean
}

/**
 * Where `userId` stands in voice room `channelId` for study (D-222): one who
 * may not view it, or with no such room, learns only "not found"
 * (NFR-SEC-05); one timed out, until when (MEMBER_TIMED_OUT): a timeout
 * leaves only VIEW_CHANNEL, so a Host timed out controls nothing either.
 * The room's settings are read fresh (the cache does not keep them), the
 * permissions from the cache (D-146).
 */
export async function studyStanding(
    { channels, checker }: StudyAccessSources,
    channelId: string,
    userId: string,
    now: Date
): Promise<StudyStanding> {
    const room = await channels.studyRoomOf(channelId)
    if (!room) throw new StudyRoomNotFoundError(channelId)
    const access = await checker.access(room.serverId, userId)
    const channel = access?.server.channels.find(
        (candidate) => candidate.id === channelId && candidate.type === 'voice'
    )
    if (!access || !channel) throw new StudyRoomNotFoundError(channelId)

    const permissions = channelPermissions(access.server, access.member, channel, now)
    if ((permissions & Permission.VIEW_CHANNEL) === 0n) throw new StudyRoomNotFoundError(channelId)
    const { timeoutUntil } = access.member
    // The owner and ADMINISTRATOR keep CONNECT through a timeout (appendix B, step 6).
    if (timeoutUntil && timeoutUntil > now && (permissions & Permission.CONNECT) === 0n) {
        throw new StudyTimedOutError(timeoutUntil)
    }
    return { room, managesStudyRooms: (permissions & Permission.MANAGE_STUDY_ROOMS) !== 0n }
}
