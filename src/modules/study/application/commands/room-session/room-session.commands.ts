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
