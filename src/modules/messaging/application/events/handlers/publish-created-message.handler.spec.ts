import { EventPublisherPort } from '@/modules/realtime'
import { MessageCreatedEvent } from '../message-created.event'
import { MessageView } from '../../services/message-views'
import { PublishCreatedMessageHandler } from './publish-created-message.handler'

describe('PublishCreatedMessageHandler (REQ-MSG-01, ARCHITECTURE 2.3)', () => {
    it('tells everyone who may view the channel, with the nonce the sender chose', () => {
        const publisher = { toChannel: jest.fn() }
        const message = { id: 'm1', channelId: 'hoi-dap', content: 'Câu 3?' } as MessageView

        new PublishCreatedMessageHandler(publisher as unknown as EventPublisherPort).handle(
            new MessageCreatedEvent(message, 'n1')
        )

        expect(publisher.toChannel).toHaveBeenCalledWith('hoi-dap', 'message.created', { message, nonce: 'n1' })
    })
})
