import { EventPublisherPort } from '@/modules/realtime'
import { SESSIONS } from '../../study-test-world.shared-spec'
import { FocusSessionChangedEvent } from '../focus-session-changed.event'
import { PublishFocusSessionHandler } from './publish-focus-session.handler'

const { running, paused, ended, solo } = SESSIONS

describe('PublishFocusSessionHandler', () => {
    function setup() {
        const publisher = { toChannel: jest.fn(), toUser: jest.fn(), toServer: jest.fn() }
        return { publisher, handler: new PublishFocusSessionHandler(publisher as unknown as EventPublisherPort) }
    }

    it('tells the room focus_session.started, .updated and .ended with what was done, by whom, and the clock', () => {
        const { publisher, handler } = setup()
        handler.handle(new FocusSessionChangedEvent(null, running, 'start', 'an', null))
        handler.handle(new FocusSessionChangedEvent(running, paused, 'pause', 'chi', null))
        handler.handle(new FocusSessionChangedEvent(paused, ended, 'stop', 'an', [{ userId: 'an', seconds: 900 }]))
        expect(
            publisher.toChannel.mock.calls.map(([room, name, data]) => [room, name, data.action, data.actorId])
        ).toEqual([
            ['phong-hoc', 'focus_session.started', 'start', 'an'],
            ['phong-hoc', 'focus_session.updated', 'pause', 'chi'],
            ['phong-hoc', 'focus_session.ended', 'stop', 'an']
        ])
        expect(publisher.toChannel.mock.calls[0][2]).toMatchObject({
            id: 'phien',
            version: 0,
            serverTime: expect.any(Date)
        })
        expect(publisher.toChannel.mock.calls[0][2]).not.toHaveProperty('summaries')
        expect(publisher.toChannel.mock.calls[2][2].summaries).toEqual([{ userId: 'an', seconds: 900 }])
    })

    it('tells no room of a Solo', () => {
        const { publisher, handler } = setup()
        handler.handle(new FocusSessionChangedEvent(null, solo, 'start', 'an', null))
        expect(publisher.toChannel).not.toHaveBeenCalled()
    })
})
