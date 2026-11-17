import { Inject, Logger } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { NOTIFIER, NotifierPort } from '@/modules/notifications'
import { MessageDeletedEvent } from '../message-deleted.event'
import { MessagesBulkDeletedEvent } from '../messages-bulk-deleted.event'

/**
 * A message deleted, by hand or with a ban (D-181), takes its inbox items
 * with it (REQ-NOTIF-03) through NOTIFIER: its row stays for the replies to
 * it, so no foreign key does. After the delete is saved; a failure is
 * logged, and the inbox leaves the item out anyway (its message is gone).
 */
@EventsHandler(MessageDeletedEvent, MessagesBulkDeletedEvent)
export class NotifyDeletedMessagesHandler implements IEventHandler<MessageDeletedEvent | MessagesBulkDeletedEvent> {
    private readonly logger = new Logger(NotifyDeletedMessagesHandler.name)

    constructor(@Inject(NOTIFIER) private readonly notifier: NotifierPort) {}

    async handle(event: MessageDeletedEvent | MessagesBulkDeletedEvent): Promise<void> {
        const ids = event instanceof MessageDeletedEvent ? [event.messageId] : event.ids
        try {
            await this.notifier.messagesDeleted(event.channelId, ids)
        } catch (error) {
            this.logger.error(`Could not take off the inbox items of ${ids.length} deleted message(s)`, error)
        }
    }
}
