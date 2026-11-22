import type { SessionSummary } from '../../domain'

/**
 * Places in Room Session `sessionId` of room `channelId` closed, published
 * after the commit (D-233): one left (on purpose, switching rooms, put out,
 * or away past 3 minutes), or the session ended with them present. Each
 * person hears `focus_session.left` with their seconds in the session, every
 * stay added, for "N phút đã được tính" on the toast of leaving.
 */
export class ParticipationClosedEvent {
    constructor(
        readonly sessionId: string,
        readonly channelId: string,
        readonly people: readonly SessionSummary[]
    ) {}
}
