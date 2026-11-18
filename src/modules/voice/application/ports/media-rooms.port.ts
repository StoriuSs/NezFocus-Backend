/** A kind of track a person may send in a room. */
export type MediaSource = 'microphone' | 'camera' | 'screen_share' | 'screen_share_audio'

/** Whom a join token is for, and what they may send (D-210). */
export interface JoinGrant {
    /** The room's name at the media server (voice:<channelId>). */
    room: string
    /** The person's user id: one connection per identity, so a second tab pushes the first out. */
    identity: string
    /** The name the others see. */
    name: string
    /** What the person's permissions allow: SPEAK the microphone, VIDEO the camera and the screen. None: listen only. */
    sources: MediaSource[]
}

/** Someone connected to a room, as the media server sees them. */
export interface RoomParticipant {
    /** The user id the token was issued for. */
    identity: string
    /** The media server's id of this connection; a reload makes a new one. */
    sid: string
    joinedAt: Date
}

/**
 * Media Rooms Port — the media server that carries the sound, video and
 * screens of voice rooms (LiveKit, D-204; ARCHITECTURE 4). Browsers connect
 * to it themselves with a token from here; the API asks it who is in a room
 * and puts people out.
 */
export interface MediaRoomsPort {
    /**
     * A short-lived token to join one room, and where to connect with it.
     * Signed here: the media server is not asked.
     */
    issueJoinToken(grant: JoinGrant): Promise<{ token: string; url: string }>

    /**
     * Who is connected to a room now. A room nobody is in has none, also when
     * the media server has never heard of it.
     * @throws MediaRoomsUnavailableError when the media server cannot be reached
     */
    listParticipants(room: string): Promise<RoomParticipant[]>

    /**
     * Ends a person's connection to a room. Nothing happens when they are not
     * in it.
     * @throws MediaRoomsUnavailableError when the media server cannot be reached
     */
    removeParticipant(room: string, identity: string): Promise<void>
}

export const MEDIA_ROOMS = Symbol('MediaRoomsPort')
