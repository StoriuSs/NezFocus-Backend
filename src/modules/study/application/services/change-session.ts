import { EventBus } from '@nestjs/cqrs'
import { UserDirectoryPort } from '@/modules/users'
import {
    FALLBACK_TIME_ZONE,
    FocusSession,
    FocusSessionRepositoryPort,
    SessionAction,
    SessionDecision,
    ZoneOf
} from '../../domain'
import { FocusSessionChangedEvent } from '../events/focus-session-changed.event'
import { StudyCountedEvent } from '../events/study-counted.event'

/** What changing a session needs. */
export interface ChangeSources {
    sessions: FocusSessionRepositoryPort
    users: UserDirectoryPort
    events: EventBus
}

/** A person's time zone for the days a count goes to: UTC when they set none (D-224). */
export const zoneOf =
    (users: UserDirectoryPort): ZoneOf =>
    async (userId) =>
        (await users.timeZoneOf(userId)) ?? FALLBACK_TIME_ZONE

/**
 * Changes a session as `decide` says (FocusSessionRepositoryPort.change),
 * then, once committed and only if something was written, tells each count
 * (`streak.updated`) and the change (`focus_session.*`, the next job, the
 * chat). `version` is the one the client saw, or null for a job's own check
 * (D-225). The session as it is after and whether it was changed, or null
 * when there is none.
 */
export async function changeSession(
    { sessions, users, events }: ChangeSources,
    sessionId: string,
    version: number | null,
    decide: SessionDecision,
    action: SessionAction,
    actorId: string | null
): Promise<{ session: FocusSession; changed: boolean } | null> {
    const change = await sessions.change(sessionId, version, decide, zoneOf(users))
    if (!change) return null
    if (change.changed) {
        for (const count of change.counts) events.publish(new StudyCountedEvent(count))
        events.publish(new FocusSessionChangedEvent(change.before, change.after, action, actorId, change.summaries))
    }
    return { session: change.after, changed: change.changed }
}
