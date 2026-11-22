/**
 * The session not yet ended of each room asked for (D-220): asked by
 * servers' ROOM_SESSIONS for the rooms in GET /servers, never by a route.
 */
export class ListRoomSessionsQuery {
    constructor(readonly channelIds: string[]) {}
}

/**
 * Who would control Room Session `sessionId` if its Host left now
 * (GET /focus-sessions/{id}/next-host, D-233), asked by `userId`, its Host,
 * for the question "Rời phòng?".
 */
export class GetNextHostQuery {
    constructor(
        readonly userId: string,
        readonly sessionId: string
    ) {}
}
