/** Someone in a voice room as everyone who may view the room sees them (D-205). */
export interface RoomPerson {
    /** Names and picture are null once the account is deleted, or waiting to be (D-182). */
    user: { id: string; username: string | null; displayName: string | null; avatarUrl: string | null }
    joinedAt: Date
    /** What their own browser says (D-206): icons only. */
    micOn: boolean
    cameraOn: boolean
    screenSharing: boolean
    /** A moderator turned their microphone off (D-207). */
    modMuted: boolean
}

/**
 * Room People Port — who is in each voice room, for the rooms in
 * `GET /servers` (D-205). Kept by the voice module, which imports this
 * module: voice answers this port through a small global module (as D-180),
 * so the code depends one way only.
 */
export interface RoomPeoplePort {
    /**
     * The people of each room asked for, in the order they joined; a room
     * nobody is in has an empty list. The caller has decided the rooms may
     * be shown.
     */
    peopleOf(channelIds: string[]): Promise<Map<string, RoomPerson[]>>
}

export const ROOM_PEOPLE = Symbol('RoomPeoplePort')
