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
        expect(publisher.toChannel.mock.calls[0][2].countedSeconds).toBeNull()
        expect(publisher.toChannel.mock.calls[2][2].summaries).toEqual([{ userId: 'an', seconds: 900 }])
    })

    it('tells a Solo to its person alone, solo_session.updated from start to end, and no room (D-222)', () => {
        const { publisher, handler } = setup()
        const done = {
            ...solo,
            status: 'ended' as const,
            endedAt: solo.startedAt,
            endedReason: 'joined_room' as const,
            countedSeconds: 1080
        }
        handler.handle(new FocusSessionChangedEvent(null, solo, 'start', 'an', null))
        handler.handle(new FocusSessionChangedEvent(solo, done, 'end', null, [{ userId: 'an', seconds: 1080 }]))
        expect(publisher.toChannel).not.toHaveBeenCalled()
        expect(
            publisher.toUser.mock.calls.map(([user, name, data]) => [user, name, data.action, data.actorId])
        ).toEqual([
            ['an', 'solo_session.updated', 'start', 'an'],
            ['an', 'solo_session.updated', 'end', null]
        ])
        expect(publisher.toUser.mock.calls[1][2]).toMatchObject({
            kind: 'solo',
            endedReason: 'joined_room',
            countedSeconds: 1080,
            summaries: [{ userId: 'an', seconds: 1080 }]
        })
    })
})
