import { Inject } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { SessionsEndedEvent } from '@/modules/auth'
import { EVENT_PUBLISHER, EventPublisherPort } from '../../ports'

/**
 * Sessions ended (sign-out, password change, revoked, account deleted...):
 * their sockets hear `session.revoked`, then are cut off (ARCHITECTURE 3.1
 * step 5). Every instance's sockets, through the Redis adapter.
 */
@EventsHandler(SessionsEndedEvent)
export class DisconnectEndedSessionsHandler implements IEventHandler<SessionsEndedEvent> {
    constructor(@Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort) {}

    handle(event: SessionsEndedEvent): void {
        this.publisher.endSessions(event.sessionIds)
    }
}
