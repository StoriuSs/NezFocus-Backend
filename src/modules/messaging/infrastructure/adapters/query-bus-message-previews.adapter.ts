import { Injectable } from '@nestjs/common'
import { QueryBus } from '@nestjs/cqrs'
import { MessagePreview, MessagePreviewsPort } from '@/modules/notifications'
import { ListMessagePreviewsQuery } from '../../application'

/**
 * Notifications' MESSAGE_PREVIEWS port, answered by this module (D-198):
 * this module calls NOTIFIER, so notifications cannot import it and asks
 * through this adapter, given by the global MessagePreviewsModule. Only
 * sends this module's own query; the handler does the reading.
 */
@Injectable()
export class QueryBusMessagePreviews implements MessagePreviewsPort {
    constructor(private readonly queryBus: QueryBus) {}

    previewsOf(messages: { id: string; serverId: string }[]): Promise<MessagePreview[]> {
        return this.queryBus.execute(new ListMessagePreviewsQuery(messages))
    }
}
