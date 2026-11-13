import { EventPublisherPort } from '@/modules/realtime'
import { MessageDeletedEvent } from '../message-deleted.event'
import { PublishDeletedMessageHandler } from './publish-deleted-message.handler'

describe('PublishDeletedMessageHandler (REQ-MSG-05, SRS 5.2)', () => {
    it('tells everyone who may view the channel which message went, and nothing of what it said', () => {
        const publisher = { toChannel: jest.fn() }

        new PublishDeletedMessageHandler(publisher as unknown as EventPublisherPort).handle(
            new MessageDeletedEvent('m1', 'hoi-dap')
        )

        expect(publisher.toChannel).toHaveBeenCalledWith('hoi-dap', 'message.deleted', {
            id: 'm1',
            channelId: 'hoi-dap'
        })
    })
})
