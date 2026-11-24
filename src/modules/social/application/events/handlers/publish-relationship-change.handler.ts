import { Inject, Logger } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { EVENT_PUBLISHER, EventPublisherPort, PRESENCE, PresencePort } from '@/modules/realtime'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { flip, listChange, PairState, RELATIONSHIP_REPOSITORY, RelationshipRepositoryPort } from '../../../domain'
import { StudyActivities } from '../../services/activities'
import { relationshipViews, ViewSources } from '../../services/relationship-views'
import { RelationshipChangedEvent } from '../relationship-changed.event'

/**
 * `relationship.added`, `relationship.updated`, `relationship.removed` to
 * every tab of each of the two (SRS 5.2, D-242), each as they see the other:
 * added and updated carry the entry as `GET /me/relationships` lists it,
 * read after the commit; removed only whom it was about. Someone blocked
 * hears only that the friendship or request went, and nothing when there
 * was none (REQ-SOCIAL-03). A failure is logged: the list is read again on
 * the next opening of the app.
 */
@EventsHandler(RelationshipChangedEvent)
export class PublishRelationshipChangeHandler implements IEventHandler<RelationshipChangedEvent> {
    private readonly logger = new Logger(PublishRelationshipChangeHandler.name)
    private readonly views: ViewSources

    constructor(
        @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort,
        @Inject(RELATIONSHIP_REPOSITORY) private readonly relationships: RelationshipRepositoryPort,
        @Inject(USER_DIRECTORY) users: UserDirectoryPort,
        @Inject(PRESENCE) presence: PresencePort,
        activities: StudyActivities
    ) {
        this.views = { users, presence, activities }
    }

    async handle({ actorId, otherId, before, after }: RelationshipChangedEvent): Promise<void> {
        await Promise.all([
            this.tell(actorId, otherId, before, after),
            this.tell(otherId, actorId, flip(before), flip(after))
        ])
    }

    /** Tells `userId` how `aboutId` changed in their list, `before` and `after` as they see it. */
    private async tell(userId: string, aboutId: string, before: PairState, after: PairState): Promise<void> {
        const change = listChange(before, after)
        if (!change) return
        try {
            if (change === 'removed') {
                this.publisher.toUser(userId, 'relationship.removed', { userId: aboutId })
                return
            }
            const entry = await this.relationships.entryOf(userId, aboutId)
            if (!entry || entry.type === 'none') return
            const [relationship] = await relationshipViews(this.views, [entry])
            this.publisher.toUser(userId, `relationship.${change}`, { relationship })
        } catch (error) {
            this.logger.error(`Could not tell ${userId} of their relationship with ${aboutId}`, error)
        }
    }
}
