import { EventBus } from '@nestjs/cqrs'
import { UserDirectoryPort } from '@/modules/users'
import { awayCloseDue, FocusSessionRepositoryPort, MayHost, PresenceChange } from '../../domain'
import { FocusSessionChangedEvent } from '../events/focus-session-changed.event'
import { ParticipationClosedEvent } from '../events/participation-closed.event'
import { ParticipationOpenedEvent } from '../events/participation-opened.event'
import { RoomPresenceChangedEvent } from '../events/room-presence-changed.event'
import { StudyCountedEvent } from '../events/study-counted.event'
import { tellChange, zoneOf } from './change-session'

/** What changing who is present needs. */
export interface PresenceSources {
    sessions: FocusSessionRepositoryPort
    users: UserDirectoryPort
    events: EventBus
    mayHost: MayHost
}

/**
 * What a committed change of who is present tells (ARCHITECTURE 5.2, 5.3):
 * each count (`streak.updated`); a new Host to the room (`focus_session.updated`,
 * action `host`, and the phase end set again for the new version); a place
 * closed in a Room Session, to its person with their seconds in it
 * (`focus_session.left`, D-233); the timers it starts (RoomPresenceChangedEvent). Someone joining or leaving
 * alone tells the room nothing here: voice tells it the people
 * (`voice_state.updated`). Nothing when there was nothing to change.
 */
export function tellPresence(events: EventBus, change: PresenceChange | null): void {
    if (!change) return
    for (const count of change.counts) events.publish(new StudyCountedEvent(count))
    if (change.changed) events.publish(new FocusSessionChangedEvent(change.before, change.after, 'host', null, null))
    const { after, left } = change
    if (left && after.kind === 'room' && after.channelId) {
        events.publish(new ParticipationClosedEvent(after.id, after.channelId, [left]))
    }
    if (change.away || change.emptySince) {
        events.publish(new RoomPresenceChangedEvent(change.after.id, change.away, change.emptySince))
    }
}

/**
 * How many times a join runs at most: once more to ask about the Host, once
 * more to close a place elsewhere or to read the zone of one whose Solo ends.
 */
const JOIN_RUNS = 3

/**
 * Someone came into voice room `channelId` (ARCHITECTURE 5.2,
 * REQ-STUDY-02): in a room with a session they take part from now, or, back
 * within 3 minutes of losing their connection, go on as if never away
 * (D-215). A place still open in another room's session (away from it, or
 * its leaving not taken yet) is closed first, there, as a leaving, whether
 * or not this room has a session (D-215: another room closes it at the time
 * they went away). A room with no Host gets them as Host if they may start a
 * session in it (REQ-STUDY-03), asked only then. A Solo of theirs ends as
 * they join a room with a session, in the same transaction (D-103), and they
 * hear it (`solo_session.updated`, `joined_room`). True when they joined a
 * session; false in a room with none. Throws when it did not settle within
 * JOIN_RUNS (each run met a change made meanwhile): the sweep joins them.
 */
export async function joinStudyRoom(sources: PresenceSources, channelId: string, userId: string): Promise<boolean> {
    const { sessions, users, events, mayHost } = sources
    let may: boolean | null = null
    let zone: string | null = null
    for (let run = 0; run < JOIN_RUNS; run++) {
        const outcome = await sessions.joinRoom(channelId, userId, may, zone)
        switch (outcome.kind) {
            case 'no_session':
                return false
            case 'joined':
                if (outcome.yielded) tellChange(events, outcome.yielded, 'end', null)
                tellPresence(events, outcome.change)
                // Where their participation is counted from, as they take part (D-232).
                events.publish(new ParticipationOpenedEvent([userId]))
                return true
            case 'ask':
                may = await mayHost(channelId, userId)
                break
            case 'zone':
                zone = await zoneOf(users)(userId)
                break
            case 'elsewhere':
                tellPresence(
                    events,
                    await sessions.leave({ sessionId: outcome.sessionId }, userId, false, mayHost, zoneOf(users))
                )
                break
        }
    }
    throw new Error(`The join of ${userId} in room ${channelId} did not settle in ${JOIN_RUNS} runs`)
}

/**
 * The place of one away since `since`, closed at `now` if AWAY_MINUTES have
 * passed (D-215): left alone if they came back, left or went away again
 * since, or when run early (another app's clock: the sweep closes it once
 * due). Counted up to when they went away and closed there; a Host hands
 * over (REQ-STUDY-03). True when it was closed.
 */
export async function closeAwayPlace(
    sources: PresenceSources,
    minuteMs: number,
    participationId: string,
    since: Date,
    now: Date
): Promise<boolean> {
    if (!awayCloseDue(since, now, minuteMs)) return false
    const { sessions, users, events, mayHost } = sources
    const change = await sessions.closeAway(participationId, since, mayHost, zoneOf(users))
    tellPresence(events, change)
    return change !== null
}
