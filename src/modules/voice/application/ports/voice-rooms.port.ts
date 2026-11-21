/** Someone in a voice room, as the study module needs them (D-225). */
export interface RoomOccupancy {
    userId: string
    channelId: string
    /** When the connection they are in the room with joined. */
    joinedAt: Date
}

/**
 * Voice Rooms Port — who is in a voice room now, for the study module
 * (D-225): one starts a session only from inside its room, and everyone in
 * it then takes part (REQ-STUDY-02); with no Host, anyone in the room may
 * resume (D-119). Read from VoiceState, which LiveKit's webhooks and the
 * reconciliation keep (D-210). Only ids and times: names are for
 * ROOM_PEOPLE.
 */
export interface VoiceRoomsPort {
    /** The people in the room, in the order they joined. */
    peopleIn(channelId: string): Promise<RoomOccupancy[]>
    /** The room the person is in, or null. */
    roomOf(userId: string): Promise<RoomOccupancy | null>
}

export const VOICE_ROOMS = Symbol('VoiceRoomsPort')
