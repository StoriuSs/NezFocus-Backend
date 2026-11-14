import { EventPublisherPort } from '@/modules/realtime'
import { ReadStateUpdatedEvent } from '../read-state-updated.event'
import { PublishReadStateUpdatedHandler } from './publish-read-state-updated.handler'

describe('PublishReadStateUpdatedHandler (REQ-MSG-09)', () => {
    it('tells every socket of the person, and no one else, where they stand in the channel', () => {
        const publisher = { toUser: jest.fn(), toChannel: jest.fn(), toServer: jest.fn() }
        const state = { serverId: 'ot', channelId: 'hoi-dap', lastReadId: 'm3', unreadCount: 0, mentionCount: 0 }

        new PublishReadStateUpdatedHandler(publisher as unknown as EventPublisherPort).handle(
            new ReadStateUpdatedEvent('binh', state)
        )

        expect(publisher.toUser).toHaveBeenCalledWith('binh', 'read_state.updated', state)
        expect(publisher.toChannel).not.toHaveBeenCalled()
        expect(publisher.toServer).not.toHaveBeenCalled()
    })
})
