import { EventPublisherPort } from '@/modules/realtime'
import { MessageUpdatedEvent } from '../message-updated.event'
import { MessageView } from '../../services/message-views'
import { PublishUpdatedMessageHandler } from './publish-updated-message.handler'

describe('PublishUpdatedMessageHandler (REQ-MSG-05, SRS 5.2)', () => {
    it('tells everyone who may view the channel the message as it now is', () => {
        const publisher = { toChannel: jest.fn() }
        const message = { id: 'm1', channelId: 'hoi-dap', content: 'Câu 4?' } as MessageView

        new PublishUpdatedMessageHandler(publisher as unknown as EventPublisherPort).handle(
            new MessageUpdatedEvent(message)
        )

        expect(publisher.toChannel).toHaveBeenCalledWith('hoi-dap', 'message.updated', { message })
    })
})
