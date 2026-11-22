import { Inject } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { EVENT_PUBLISHER, EventPublisherPort } from '@/modules/realtime'
import { ParticipationClosedEvent } from '../participation-closed.event'

/**
 * `focus_session.left` to every socket of each person whose place in a Room
 * Session closed (SRS 5.2, D-233): the session, its room and their seconds
 * in it, every stay added, as counted in the commit that closed it. The
 * client adds "N phút đã được tính" to the toast of leaving that room.
 */
@EventsHandler(ParticipationClosedEvent)
export class PublishSessionLeftHandler implements IEventHandler<ParticipationClosedEvent> {
    constructor(@Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort) {}

    handle({ sessionId, channelId, people }: ParticipationClosedEvent): void {
        for (const { userId, seconds } of people) {
            this.publisher.toUser(userId, 'focus_session.left', { sessionId, channelId, seconds })
        }
    }
}
