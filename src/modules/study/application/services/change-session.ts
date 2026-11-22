import { EventBus } from '@nestjs/cqrs'
import { UserDirectoryPort } from '@/modules/users'
import {
    FALLBACK_TIME_ZONE,
    FocusSession,
    FocusSessionRepositoryPort,
    SessionAction,
    SessionChange,
    SessionDecision,
    ZoneOf
} from '../../domain'
import { FocusSessionChangedEvent } from '../events/focus-session-changed.event'
import { ParticipationClosedEvent } from '../events/participation-closed.event'
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
 * What a committed change of a session tells, when something was written:
 * each count (`streak.updated`) and the change (`focus_session.*` or
 * `solo_session.updated`, the next job, the chat); a Room Session's end, to
 * each person whose place it closed, their seconds in it (`focus_session.left`, D-233).
 */
export function tellChange(
    events: EventBus,
    change: SessionChange,
    action: SessionAction,
    actorId: string | null
): void {
    if (!change.changed) return
    for (const count of change.counts) events.publish(new StudyCountedEvent(count))
    events.publish(new FocusSessionChangedEvent(change.before, change.after, action, actorId, change.summaries))
    const { after, summaries } = change
    if (after.status === 'ended' && after.kind === 'room' && after.channelId && summaries) {
        // Those the end counted (D-233): everyone still in, and one who left while a phase was overdue
        // (counted on to its due end), told again with their total so far: the client only adds it to
        // a toast of leaving still open, where it is right.
        const closed = new Set(change.counts.map(({ userId }) => userId))
        const people = summaries.filter(({ userId }) => closed.has(userId))
        if (people.length > 0) events.publish(new ParticipationClosedEvent(after.id, after.channelId, people))
    }
}

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
    tellChange(events, change, action, actorId)
    return { session: change.after, changed: change.changed }
}
