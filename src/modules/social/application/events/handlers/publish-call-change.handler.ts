import { Inject, Logger } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { EVENT_PUBLISHER, EventPublisherPort } from '@/modules/realtime'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { isOpenCall } from '../../../domain'
import { callViews } from '../../services/call-views'
import { CallChangedEvent } from '../call-changed.event'

/**
 * Tells the tabs of a call's two people what became of it (SRS 5.2, D-106,
 * D-242), each with the call as they see it:
 * - made ringing: `call.ringing` to its callee (every tab rings) and
 *   `call.updated` to its caller (their other tabs: "calling in another tab");
 * - answered: `call.updated` to both (the tab that answered keeps it, the
 *   others close their card);
 * - over: `call.ended` to both; a call made missed because its callee was
 *   busy only to its caller, as the callee never heard it ring (spec 09).
 * A failure is logged: the app reads `GET /me/call` again on reload.
 */
@EventsHandler(CallChangedEvent)
export class PublishCallChangeHandler implements IEventHandler<CallChangedEvent> {
    private readonly logger = new Logger(PublishCallChangeHandler.name)

    constructor(
        @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort
    ) {}

    async handle({ call, before }: CallChangedEvent): Promise<void> {
        try {
            const told: [string, string][] =
                before === null && call.status === 'ringing'
                    ? [
                          [call.calleeId, 'call.ringing'],
                          [call.callerId, 'call.updated']
                      ]
                    : before === null
                      ? [[call.callerId, 'call.ended']]
                      : [
                            [call.callerId, isOpenCall(call) ? 'call.updated' : 'call.ended'],
                            [call.calleeId, isOpenCall(call) ? 'call.updated' : 'call.ended']
                        ]
            for (const [userId, event] of told) {
                const [view] = await callViews(this.users, userId, [call])
                this.publisher.toUser(userId, event, { call: view })
            }
        } catch (error) {
            this.logger.error(`Could not tell the two of call ${call.id} of its change`, error)
        }
    }
}
