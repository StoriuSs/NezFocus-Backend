/**
 * A socket that has just joined its rooms (`rooms`: those the handshake
 * worked out), to be moved again in each of its servers: what changed while
 * it connected reached no one's sockets but those already in the rooms.
 */
export class SettleRoomsCommand {
    constructor(
        readonly userId: string,
        readonly rooms: string[]
    ) {}
}
