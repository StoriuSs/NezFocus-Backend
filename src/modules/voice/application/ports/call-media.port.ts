/** A connection in a call's room, as the media server sees it. */
export interface CallConnection {
    /** The user id the token was issued for. */
    userId: string
    /** The media server's id of this connection; a reload makes a new one. */
    participantSid: string
    joinedAt: Date
    /** The sign-in session the token was issued to (D-214); null when the token had none. */
    sessionId: string | null
}

/**
 * Call Media Port — the media room of a one-to-one call (`call:<id>`,
 * D-239), for social, which keeps the calls: voice stays the one module
 * that speaks to LiveKit. What happens in the rooms comes back as
 * CallMediaChangedEvent.
 */
export interface CallMediaPort {
    /**
     * A token to join the call's room, sending the microphone and the camera
     * (D-242), carrying `sessionId` (D-214). Someone in a voice room is put
     * out of it first: one media connection per account (D-210).
     * @throws MediaRoomsUnavailableError when they could not be put out of their voice room
     */
    joinToken(callId: string, userId: string, sessionId: string): Promise<{ token: string; url: string }>

    /**
     * Who is connected to the call's room now; none when there is no room.
     * @throws MediaRoomsUnavailableError when the media server cannot be reached
     */
    participants(callId: string): Promise<CallConnection[]>

    /**
     * The calls the media server has a room for now.
     * @throws MediaRoomsUnavailableError when the media server cannot be reached
     */
    rooms(): Promise<string[]>

    /**
     * Ends one connection to the call's room, only while it is the one the
     * media server holds for that person (D-214). True when it ended it.
     * @throws MediaRoomsUnavailableError when the media server cannot be reached
     */
    removeConnection(callId: string, userId: string, participantSid: string): Promise<boolean>

    /**
     * Closes the call's room, everyone in it put out; nothing when there is none.
     * @throws MediaRoomsUnavailableError when the media server cannot be reached
     */
    close(callId: string): Promise<void>
}

export const CALL_MEDIA = Symbol('CallMediaPort')
