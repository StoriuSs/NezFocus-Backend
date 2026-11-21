import { ChannelDirectoryPort } from '@/modules/servers'
import { EndReason, selfEndMove } from '../../domain'
import { changeSession, ChangeSources } from './change-session'

/** What ending the sessions of rooms gone needs. */
export interface GoneRoomSources extends ChangeSources {
    channels: ChannelDirectoryPort
    minuteMs: number
}

/**
 * Why a Room Session's room can hold it no more (REQ-STUDY-02, D-227): the
 * channel or its server is gone (`channel_deleted`), or it is no study room
 * any more (`study_disabled`); null while it still is one.
 */
async function goneReason(channels: ChannelDirectoryPort, channelId: string): Promise<EndReason | null> {
    const room = await channels.studyRoomOf(channelId)
    if (!room) return 'channel_deleted'
    return room.isStudyRoom ? null : 'study_disabled'
}

/**
 * Ends the session if its room can hold it no more (goneReason), as read
 * now: the phase ends it missed first, everyone counted, the room told
 * (action `end`). True when it ended it.
 */
export async function endIfRoomGone(
    sources: GoneRoomSources,
    session: { id: string; channelId: string }
): Promise<boolean> {
    const reason = await goneReason(sources.channels, session.channelId)
    if (!reason) return false
    const change = await changeSession(
        sources,
        session.id,
        null,
        (current, at) => selfEndMove(current, at, sources.minuteMs, reason),
        'end',
        null
    )
    return change?.changed ?? false
}
