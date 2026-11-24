/** A voice room's study settings (REQ-STUDY-01), as the study module reads them when a session starts (D-222). */
export interface StudyRoomSettings {
    serverId: string
    isStudyRoom: boolean
    /** `managers`: only those with MANAGE_STUDY_ROOMS start a session. */
    studyStarter: 'anyone' | 'managers'
    /** The cycle a session starts with when none is asked for, in minutes; both long-break halves set, or neither. */
    focusMinutes: number
    shortBreakMinutes: number
    longBreakMinutes: number | null
    longBreakEvery: number | null
}

/** Names of servers and channels, for a line that names where something was (D-230). */
export interface PlaceNames {
    /** Each server asked for that is not deleted, by id. */
    servers: Map<string, string>
    /** Each channel asked for that is still there, in a server not deleted, by id. */
    channels: Map<string, string>
}

/**
 * Channel Directory Port — what the servers module tells other modules about
 * where a channel is. The messaging module asks it on every message route,
 * which names only the channel (`/channels/{id}/messages`), to learn whose
 * permissions apply; the realtime module, for the rooms of a server's
 * channels.
 *
 * Only the place: whether the person may see or post in it is the
 * permissions module's to answer (PERMISSION_CHECKER).
 */
export interface ChannelDirectoryPort {
    /** The server the channel is in; null when there is no such channel or its server was deleted. */
    serverIdOf(channelId: string): Promise<string | null>

    /**
     * Every channel of the server, text or voice, also of a server just
     * deleted (its channels stay until the clean-up): the rooms a socket
     * leaves when it may no longer be there (D-178). A channel deleted is no
     * longer here: its room hears nothing again. In no order.
     */
    channelIdsOf(serverId: string): Promise<string[]>

    /**
     * The study settings of a voice room, read fresh (the permission cache
     * does not keep them, D-222); null when there is no voice room by that id
     * or its server was deleted. Whether the person may see it is
     * PERMISSION_CHECKER's to answer.
     */
    studyRoomOf(channelId: string): Promise<StudyRoomSettings | null>

    /**
     * The names of these servers and channels: study's history of sessions
     * names the room and server of each line (D-230). Whether the person may
     * see them is PERMISSION_CHECKER's to answer; one deleted is left out.
     */
    namesOf(serverIds: string[], channelIds: string[]): Promise<PlaceNames>

    /**
     * Those of these voice rooms that are study rooms, in a server not
     * deleted: whether someone in a room is "studying with a group" or "in a
     * voice room" (D-79, D-247). One read for them all.
     */
    studyRoomsAmong(channelIds: string[]): Promise<string[]>
}

export const CHANNEL_DIRECTORY = Symbol('ChannelDirectoryPort')
