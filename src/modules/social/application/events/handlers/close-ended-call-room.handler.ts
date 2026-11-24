import { Inject, Logger } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { CALL_MEDIA, type CallMediaPort } from '@/modules/voice'
import { isOpenCall } from '../../../domain'
import { CallChangedEvent } from '../call-changed.event'

/**
 * An active call over, whatever ended it (D-242): its room at LiveKit is
 * closed, both put out, so neither stays connected to a call the other
 * hung up or the server ended. A call never answered has no room. LiveKit
 * unreachable: logged, and the sweep closes the room (D-246).
 */
@EventsHandler(CallChangedEvent)
export class CloseEndedCallRoomHandler implements IEventHandler<CallChangedEvent> {
    private readonly logger = new Logger(CloseEndedCallRoomHandler.name)

    constructor(@Inject(CALL_MEDIA) private readonly media: CallMediaPort) {}

    async handle({ call, before }: CallChangedEvent): Promise<void> {
        if (before !== 'active' || isOpenCall(call)) return
        try {
            await this.media.close(call.id)
        } catch (error) {
            this.logger.warn(`The room of call ${call.id} not closed: ${String(error)}`)
        }
    }
}
