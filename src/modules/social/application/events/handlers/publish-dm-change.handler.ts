import { Inject, Logger } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { LAST_MESSAGES, LastMessagesPort } from '@/modules/messaging'
import { DM_ROOMS, DmRoomsPort, EVENT_PUBLISHER, EventPublisherPort, PRESENCE, PresencePort } from '@/modules/realtime'
import { MEMBERSHIP, MembershipPort } from '@/modules/servers'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import {
    DM_REPOSITORY,
    DmRepositoryPort,
    isShownDm,
    RELATIONSHIP_REPOSITORY,
    RelationshipRepositoryPort
} from '../../../domain'
import { StudyActivities } from '../../services/activities'
import { dmViews, DmViewSources } from '../../services/dm-views'
import { DmChangedEvent } from '../dm-changed.event'

/**
 * Tells the tabs of the one whose side changed (SRS 5.2, D-242, D-244):
 * `dm.created` for a DM they just made, `dm.updated` when they open one
 * again or close it, each with the DM as they see it, read after the
 * commit, and `shown` for whether it is now in their list. A new DM first
 * puts the sockets of both of its two in its room, so its first message
 * reaches the other one, whose list shows it then. A failure is logged:
 * the list is read again on the next opening of the app.
 */
@EventsHandler(DmChangedEvent)
export class PublishDmChangeHandler implements IEventHandler<DmChangedEvent> {
    private readonly logger = new Logger(PublishDmChangeHandler.name)
    private readonly views: DmViewSources

    constructor(
        @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort,
        @Inject(DM_ROOMS) private readonly rooms: DmRoomsPort,
        @Inject(DM_REPOSITORY) private readonly dms: DmRepositoryPort,
        @Inject(RELATIONSHIP_REPOSITORY) relationships: RelationshipRepositoryPort,
        @Inject(MEMBERSHIP) membership: MembershipPort,
        @Inject(USER_DIRECTORY) users: UserDirectoryPort,
        @Inject(PRESENCE) presence: PresencePort,
        @Inject(LAST_MESSAGES) lastMessages: LastMessagesPort,
        activities: StudyActivities
    ) {
        this.views = { relationships, membership, users, presence, activities, lastMessages }
    }

    async handle({ userId, channelId, change, otherId }: DmChangedEvent): Promise<void> {
        try {
            if (change === 'created') await this.rooms.join(channelId, [userId, otherId])
            const entry = await this.dms.entryOf(userId, channelId)
            if (!entry) return
            const [dm] = await dmViews(this.views, userId, [entry])
            if (change === 'created') {
                this.publisher.toUser(userId, 'dm.created', { dm })
                return
            }
            // Shown as the row stands now, not as the event says: a close and an
            // opening from two tabs at once may be told in either order.
            const shown = isShownDm(entry.closedAt, dm!.lastMessage?.createdAt ?? null)
            this.publisher.toUser(userId, 'dm.updated', { dm, shown })
        } catch (error) {
            this.logger.error(`Could not tell ${userId} of their DM ${channelId}`, error)
        }
    }
}
