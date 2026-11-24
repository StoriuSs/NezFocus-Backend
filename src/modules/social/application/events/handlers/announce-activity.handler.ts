import { Inject, Logger } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { EVENT_PUBLISHER, EventPublisherPort } from '@/modules/realtime'
import {
    CHANNEL_DIRECTORY,
    ChannelDirectoryPort,
    MEMBERSHIP,
    MembershipPort,
    ServerChangedEvent
} from '@/modules/servers'
import { FocusSessionChangedEvent } from '@/modules/study'
import { PresenceChosenEvent, StudyActivitySwitchedEvent } from '@/modules/users'
import { VOICE_ROOMS, VoiceRoomsPort, VoiceStateChangedEvent } from '@/modules/voice'
import { ActivityTrigger, mayTellActivity, RELATIONSHIP_REPOSITORY, RelationshipRepositoryPort } from '../../../domain'
import { ACTIVITY_LOCK, ActivityLockPort } from '../../ports'
import { StudyActivities } from '../../services/activities'
import { CallChangedEvent } from '../call-changed.event'

/** Every change that may change someone's activity line (D-242, L5 addendum). */
type ActivityChange =
    | VoiceStateChangedEvent
    | FocusSessionChangedEvent
    | PresenceChosenEvent
    | StudyActivitySwitchedEvent
    | CallChangedEvent
    | ServerChangedEvent

/**
 * Tells the activity line of whoever a change touched (D-240, D-247):
 * `activity.updated { user_id, activity }`, the same for every viewer, to
 * each server they are in and each of their friends, as their presence
 * goes (D-242); `activity` null when they show nothing now. Someone hidden
 * is told only when they save the settings, and someone in a call only for
 * the call (mayTellActivity): no beat of null lines. Read after the commit,
 * and read and sent while holding the person's lock (ACTIVITY_LOCK, L5-e):
 * of two changes told at once the second reads after the first went out, so
 * the last line anyone hears is the one now. Whom to tell is read before.
 * Each change is one event, not compared with the last. A failure is
 * logged: the lists are read again on the next opening of the app.
 */
@EventsHandler(
    VoiceStateChangedEvent,
    FocusSessionChangedEvent,
    PresenceChosenEvent,
    StudyActivitySwitchedEvent,
    CallChangedEvent,
    ServerChangedEvent
)
export class AnnounceActivityHandler implements IEventHandler<ActivityChange> {
    private readonly logger = new Logger(AnnounceActivityHandler.name)

    constructor(
        private readonly activities: StudyActivities,
        @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort,
        @Inject(MEMBERSHIP) private readonly membership: MembershipPort,
        @Inject(RELATIONSHIP_REPOSITORY) private readonly relationships: RelationshipRepositoryPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(VOICE_ROOMS) private readonly voiceRooms: VoiceRoomsPort,
        @Inject(ACTIVITY_LOCK) private readonly lock: ActivityLockPort
    ) {}

    async handle(change: ActivityChange): Promise<void> {
        try {
            const { trigger, userIds } = await this.peopleOf(change)
            if (userIds.length === 0) return
            const audiences = await Promise.all(userIds.map((userId) => this.audienceOf(userId)))
            await this.lock.whileHeld(userIds, async () => {
                const lines = await this.activities.read(userIds)
                userIds.forEach((userId, index) => {
                    const line = lines.get(userId)!
                    if (!mayTellActivity(trigger, line)) return
                    const event = { userId, activity: line.activity }
                    const { serverIds, friendIds } = audiences[index]!
                    for (const serverId of serverIds) this.publisher.toServer(serverId, 'activity.updated', event)
                    for (const friendId of friendIds) this.publisher.toUser(friendId, 'activity.updated', event)
                })
            })
        } catch (error) {
            this.logger.error(`Could not tell an activity after ${change.constructor.name}`, error)
        }
    }

    /** Whose line the change may have changed, and what kind of change it is. */
    private async peopleOf(change: ActivityChange): Promise<{ trigger: ActivityTrigger; userIds: string[] }> {
        const study = (userIds: string[]) => ({ trigger: 'study' as const, userIds })
        if (change instanceof VoiceStateChangedEvent) {
            // Their microphone or camera is no part of the line.
            return study(change.change === 'updated' ? [] : [change.userId])
        }
        if (change instanceof FocusSessionChangedEvent) {
            // A Room Session's phase is in the room's own data (D-220): only a Solo is in the line.
            return study(change.after.kind === 'solo' && change.after.userId ? [change.after.userId] : [])
        }
        if (change instanceof PresenceChosenEvent || change instanceof StudyActivitySwitchedEvent) {
            return { trigger: 'settings', userIds: [change.userId] }
        }
        if (change instanceof CallChangedEvent) {
            // In an active call shows nothing (spec 09 rule 7): told when the call becomes active, and when it stops being.
            const wasActive = change.before === 'active'
            const isActive = change.call.status === 'active'
            return {
                trigger: 'call',
                userIds: wasActive === isActive ? [] : [change.call.callerId, change.call.calleeId]
            }
        }
        // A channel changed: maybe a room turned into a study room or out of one.
        if (!change.changes.some((one) => one.topic === 'channel' && one.action === 'updated')) return study([])
        const people = await this.voiceRooms.peopleInRooms(await this.channels.channelIdsOf(change.serverId))
        return study(people.map((person) => person.userId))
    }

    /** Whom a person's line goes to: their servers and their friends, as presence goes. */
    private async audienceOf(userId: string): Promise<{ serverIds: string[]; friendIds: string[] }> {
        const [serverIds, friendIds] = await Promise.all([
            this.membership.serverIdsOf(userId),
            this.relationships.friendIdsOf(userId)
        ])
        return { serverIds, friendIds }
    }
}
