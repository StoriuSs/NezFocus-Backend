/**
 * Someone asked to leave their voice room (`POST /voice/leave`: Rời, another
 * room, signing out), published once it is done, whether or not a row was
 * left to remove: LiveKit's participant_left often comes first, as the page
 * leaves LiveKit before it asks, and is told as a lost connection. Study
 * hears it as a leaving meant (D-228): the place is closed and the Host
 * handed over at once, not 3 minutes on.
 */
export class VoiceLeaveRequestedEvent {
    constructor(public readonly userId: string) {}
}
