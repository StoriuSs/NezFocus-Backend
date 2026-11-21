import { Inject } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { EVENT_PUBLISHER, EventPublisherPort } from '@/modules/realtime'
import { FocusSessionChangedEvent } from '../focus-session-changed.event'
import { sessionView } from '../../services/session-views'

/**
 * `focus_session.started / updated / ended` to the room (SRS 5.2, D-222),
 * to every socket that may view it (D-205), never the server: a private
 * room stays private. Each carries the whole session with the server's
 * clock, what was done and by whom (the toasts of spec 07: "An đã tạm
 * dừng"; no one for the end of a phase), and, once ended, every
 * participant's seconds (D-49). A Solo is its person's alone:
 * `solo_session.updated` to them, from its start to its end, the same body
 * (D-222), so each of their tabs and devices follows it.
 */
@EventsHandler(FocusSessionChangedEvent)
export class PublishFocusSessionHandler implements IEventHandler<FocusSessionChangedEvent> {
    constructor(@Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort) {}

    handle({ before, after, action, actorId, summaries }: FocusSessionChangedEvent): void {
        const body = { ...sessionView(after, new Date()), action, actorId, ...(summaries && { summaries }) }
        if (after.kind === 'solo' && after.userId) {
            this.publisher.toUser(after.userId, 'solo_session.updated', body)
            return
        }
        if (!after.channelId) return
        const name = !before ? 'started' : after.status === 'ended' ? 'ended' : 'updated'
        this.publisher.toChannel(after.channelId, `focus_session.${name}`, body)
    }
}
