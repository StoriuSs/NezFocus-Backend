import { Cycle } from '../../../domain'

/**
 * Start a Room Session in a study room (REQ-STUDY-02, `POST
 * /channels/{id}/focus-session`): with the cycle sent, or the room's default
 * when no part of one is.
 */
export class StartRoomSessionCommand {
    constructor(
        readonly userId: string,
        readonly channelId: string,
        readonly cycle: Partial<Cycle>
    ) {}
}

/**
 * End the sessions of the server's rooms that can hold one no more (D-227):
 * a room deleted, or its server (`channel_deleted`), or no study room any
 * more (`study_disabled`). Sent when the server's channels changed.
 */
export class EndGoneRoomSessionsCommand {
    constructor(readonly serverId: string) {}
}
