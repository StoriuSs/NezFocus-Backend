/** A connection came into a call's room, or went (LiveKit's participant_joined / participant_left). */
export type CallRoomChange =
    | {
          kind: 'joined'
          userId: string
          participantSid: string
          joinedAt: Date
          /** The sign-in session of its token (D-214), live when told; null for a token without one. */
          sessionId: string | null
      }
    | {
          kind: 'left'
          userId: string
          participantSid: string
          /** When the webhook came (LiveKit's own createdAt is to the second only). */
          at: Date
      }

/**
 * Something happened in the room of a one-to-one call (`call:<id>`, D-239),
 * as LiveKit's webhook told it, taken once per event id. Social keeps who of
 * a call's two is in its room and puts out anyone who should not be there;
 * a join of a session already ended was put out here (D-214) and is not
 * told. Not sent again when its handler fails: social's sweep reads the
 * room's people every minute (D-246).
 */
export class CallMediaChangedEvent {
    constructor(
        public readonly callId: string,
        public readonly change: CallRoomChange
    ) {}
}
