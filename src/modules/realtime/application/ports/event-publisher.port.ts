/**
 * Event Publisher Port — how any module sends an event to the people it
 * concerns (SRS 5.2, ARCHITECTURE 3.2). Reaches every app instance through
 * the socket.io Redis adapter.
 *
 * `data` is written in camelCase like the rest of the code and goes out in
 * snake_case, like the REST API's JSON. Fire and forget: a socket that misses
 * an event catches up over REST when it reconnects (ARCHITECTURE 3.4).
 */
export interface EventPublisherPort {
    /** To every socket of one person. */
    toUser(userId: string, event: string, data: object): void
    /** To every member's sockets in one server. */
    toServer(serverId: string, event: string, data: object): void
    /** To every socket whose person may view one text channel (D-163). */
    toChannel(channelId: string, event: string, data: object): void
    /** Tells these sessions' sockets `session.revoked`, then cuts them off. */
    endSessions(sessionIds: string[]): void
}

export const EVENT_PUBLISHER = Symbol('EventPublisherPort')
