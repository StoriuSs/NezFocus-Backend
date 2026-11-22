import { EventPublisherPort } from '@/modules/realtime'
import { ParticipationClosedEvent } from '../participation-closed.event'
import { PublishSessionLeftHandler } from './publish-session-left.handler'

describe('PublishSessionLeftHandler (D-233)', () => {
    it('tells each person whose place closed, and only them, their seconds in the session and its room', () => {
        const publisher = { toUser: jest.fn(), toChannel: jest.fn(), toServer: jest.fn() }
        const handler = new PublishSessionLeftHandler(publisher as unknown as EventPublisherPort)

        handler.handle(
            new ParticipationClosedEvent('s1', 'room-1', [
                { userId: 'an', seconds: 1860 },
                { userId: 'binh', seconds: 0 }
            ])
        )

        expect(publisher.toUser).toHaveBeenCalledTimes(2)
        expect(publisher.toUser).toHaveBeenCalledWith('an', 'focus_session.left', {
            sessionId: 's1',
            channelId: 'room-1',
            seconds: 1860
        })
        expect(publisher.toUser).toHaveBeenCalledWith('binh', 'focus_session.left', {
            sessionId: 's1',
            channelId: 'room-1',
            seconds: 0
        })
        expect(publisher.toChannel).not.toHaveBeenCalled()
        expect(publisher.toServer).not.toHaveBeenCalled()
    })
})
