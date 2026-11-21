/**
 * The session not yet ended of each room asked for (D-220): asked by
 * servers' ROOM_SESSIONS for the rooms in GET /servers, never by a route.
 */
export class ListRoomSessionsQuery {
    constructor(readonly channelIds: string[]) {}
}
