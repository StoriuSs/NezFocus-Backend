import { Inject, Logger } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { NOTIFIER, NotifierPort } from '@/modules/notifications'
import { ReadStateUpdatedEvent } from '../read-state-updated.event'

/**
 * Every time someone's ReadState moves on (an ack, or sending there, D-173),
 * their mention and reply items of that channel up to it are read (D-188),
 * through NOTIFIER. Never the other way: reading in the inbox leaves the
 * channel unread (D-99). A failure is logged; the items stay unread until
 * the next time the channel is read.
 */
@EventsHandler(ReadStateUpdatedEvent)
export class NotifyChannelReadHandler implements IEventHandler<ReadStateUpdatedEvent> {
    private readonly logger = new Logger(NotifyChannelReadHandler.name)

    constructor(@Inject(NOTIFIER) private readonly notifier: NotifierPort) {}

    async handle({ userId, state }: ReadStateUpdatedEvent): Promise<void> {
        try {
            await this.notifier.channelRead(userId, state.channelId, state.lastReadId)
        } catch (error) {
            this.logger.error(`Could not mark read the inbox items of channel ${state.channelId}`, error)
        }
    }
}
