/**
 * People started taking part in a study session (a Room Session started with
 * them present, one joined a room with a session, a Solo started), published
 * after the commit: each hears `streak.updated`, with where their new
 * participation is counted from, so their minutes today grow from now
 * (D-232). Also as one comes back within 3 minutes (D-215) or joins a room
 * they were already taking part in: nothing new opened, the same numbers
 * told again, which does no harm.
 */
export class ParticipationOpenedEvent {
    constructor(readonly userIds: readonly string[]) {}
}
