import { Logger } from '@nestjs/common'
import { CommandBus, EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { PostCallEndedCommand } from '@/modules/messaging'
import { callSeconds, isOpenCall } from '../../../domain'
import { CallChangedEvent } from '../call-changed.event'

/**
 * A call over (REQ-MSG-08, REQ-SOCIAL-06, D-106, D-242): its system message
 * in the DM (`call_ended`: who called, how it ended, for how long), through
 * messaging's PostCallEndedCommand over the bus. A missed call names its
 * callee, whose inbox item messaging writes through NOTIFIER before the DM
 * hears the message (L4-f; none for someone who blocked the caller). A
 * declined call has no item (SOCIAL-06). A failure is logged: the call is
 * over either way.
 */
@EventsHandler(CallChangedEvent)
export class RecordCallEndHandler implements IEventHandler<CallChangedEvent> {
    private readonly logger = new Logger(RecordCallEndHandler.name)

    constructor(private readonly commandBus: CommandBus) {}

    async handle({ call }: CallChangedEvent): Promise<void> {
        if (isOpenCall(call)) return
        try {
            await this.commandBus.execute(
                new PostCallEndedCommand(
                    call.dmChannelId,
                    {
                        userId: call.callerId,
                        callId: call.id,
                        status: call.status as 'ended' | 'declined' | 'missed' | 'failed',
                        endReason: call.endReason,
                        video: call.video,
                        durationSeconds: callSeconds(call)
                    },
                    call.status === 'missed' ? call.calleeId : null
                )
            )
        } catch (error) {
            this.logger.error(`Could not record the end of call ${call.id}`, error)
        }
    }
}
