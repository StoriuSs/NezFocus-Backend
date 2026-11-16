import { EventPublisherPort } from '@/modules/realtime'
import { MessagesBulkDeletedEvent } from '../messages-bulk-deleted.event'
import { PublishBulkDeletedMessagesHandler } from './publish-bulk-deleted-messages.handler'

describe('PublishBulkDeletedMessagesHandler (D-181, SRS 5.2)', () => {
    it('tells everyone who may view the channel which messages went, in one event', () => {
        const publisher = { toChannel: jest.fn() }

        new PublishBulkDeletedMessagesHandler(publisher as unknown as EventPublisherPort).handle(
            new MessagesBulkDeletedEvent('hoi-dap', ['m1', 'm2'])
        )

        expect(publisher.toChannel).toHaveBeenCalledWith('hoi-dap', 'message.bulk_deleted', {
            channelId: 'hoi-dap',
            ids: ['m1', 'm2']
        })
    })
})
