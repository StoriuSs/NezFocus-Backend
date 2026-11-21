import { FocusSession, SessionAction, SessionSummary } from '../../domain'

/**
 * A study session started or changed (ARCHITECTURE 5.1, D-222), published
 * after the commit: the room hears `focus_session.*`, the next phase end is
 * set, and a start or an end is said in the room's chat (REQ-MSG-08).
 */
export class FocusSessionChangedEvent {
    constructor(
        /** Null when it just started. */
        readonly before: FocusSession | null,
        readonly after: FocusSession,
        readonly action: SessionAction,
        /** Who did it; null when its job did (the end of a phase). */
        readonly actorId: string | null,
        /** Once it ended: every participant's seconds in it (D-49). */
        readonly summaries: SessionSummary[] | null
    ) {}
}
