import { Inject, Logger } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { NOTIFIER, NotifierPort } from '@/modules/notifications'
import { RELATIONSHIP_REPOSITORY, RelationshipRepositoryPort, requestClosed } from '../../../domain'
import { RelationshipChangedEvent } from '../relationship-changed.event'

/**
 * The inbox items of a change (NOTIF-01, NOTIF-03, D-111, D-242), through
 * NOTIFIER: a request gives the one asked a `friend_request` with its note;
 * accepting gives the one who asked a `friend_accepted`, and the request's
 * item goes; a request declined, cancelled or ended by a block loses its
 * item. Run after the commit; a failure is logged.
 *
 * A request's item is written by one handler and taken off by another, in
 * no set order: one cancelled at once may be taken off before it is in. So
 * once it is in, the pair is read again, and an item whose request no longer
 * waits is taken off (as SyncMessageItemsHandler does for a message deleted
 * meanwhile).
 */
@EventsHandler(RelationshipChangedEvent)
export class NotifyRelationshipChangeHandler implements IEventHandler<RelationshipChangedEvent> {
    private readonly logger = new Logger(NotifyRelationshipChangeHandler.name)

    constructor(
        @Inject(NOTIFIER) private readonly notifier: NotifierPort,
        @Inject(RELATIONSHIP_REPOSITORY) private readonly relationships: RelationshipRepositoryPort
    ) {}

    async handle({ actorId, otherId, before, after, write }: RelationshipChangedEvent): Promise<void> {
        try {
            if (write.write === 'request') {
                await this.notifier.friendRequested(actorId, otherId, write.note)
                const now = await this.relationships.entryOf(actorId, otherId)
                if (now?.type !== 'outgoing') await this.notifier.friendRequestClosed(actorId, otherId)
            } else if (write.write === 'accept') await this.notifier.friendAccepted(otherId, actorId)
            else if (requestClosed(before, after)) await this.notifier.friendRequestClosed(actorId, otherId)
        } catch (error) {
            this.logger.error(`Could not write the inbox items of ${actorId} and ${otherId}`, error)
        }
    }
}
