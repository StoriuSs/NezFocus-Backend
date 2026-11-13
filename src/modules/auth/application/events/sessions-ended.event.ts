/**
 * Domain Event: Sessions Ended
 *
 * Published whenever sessions are ended: signing out, a password change or
 * reset, revoking one or all other sessions, a refresh token used twice, a
 * deleted account, and the hourly clean-up's ending of sessions left to a
 * deleted account. The realtime module reacts by telling each session's
 * sockets (`session.revoked`) and cutting them off (ARCHITECTURE 3.1).
 *
 * A session that simply runs out (its refresh cookie expires) is not ended
 * by anyone, so it is not here: its socket stays open until the tab's next
 * refresh fails and signs out, which closes the socket with the shell.
 *
 * Published by SessionEnds, the one step every one of those goes through.
 */
export class SessionsEndedEvent {
    constructor(public readonly sessionIds: string[]) {}
}
