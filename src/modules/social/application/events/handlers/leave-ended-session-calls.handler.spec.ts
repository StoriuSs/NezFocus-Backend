import { SessionsEndedEvent } from '@/modules/auth'
import { CallPresence } from '../../../domain'
import { socialWorld } from '../../social-test-world.shared-spec'
import { LeaveEndedSessionCallsHandler } from './leave-ended-session-calls.handler'

const acceptedAt = new Date('2026-11-24T21:44:06Z')
const at = (seconds: number) => new Date(acceptedAt.getTime() + seconds * 1000)

function setUp() {
    const world = socialWorld()
    const handler = new LeaveEndedSessionCallsHandler(world.calls, world.callJobs, world.callMedia, world.eventBus)
    const call = world.callAs({
        callerId: 'an',
        calleeId: 'binh',
        dmChannelId: 'dm-an-binh',
        status: 'active',
        version: 1,
        acceptedAt
    })
    const row = (userId: string, sessionId: string): CallPresence => ({
        userId,
        participantSid: `PA_${userId}`,
        joinedAt: at(2),
        leftAt: null,
        sessionId
    })
    world.callPresence.set(call.id, [row('an', 'session-an'), row('binh', 'session-binh')])
    const ended = (...sessionIds: string[]) => new SessionsEndedEvent(sessionIds)
    return { world, handler, call, ended }
}

describe('LeaveEndedSessionCallsHandler (D-214, D-242)', () => {
    beforeEach(() => jest.useFakeTimers({ now: at(60), doNotFake: ['nextTick', 'setImmediate'] }))
    afterEach(() => jest.useRealTimers())

    it('puts the connection of an ended session out of its call room and marks it out: 30 seconds to come back', async () => {
        const { world, handler, call, ended } = setUp()

        await handler.handle(ended('session-an'))

        expect(world.callMedia.removeConnection).toHaveBeenCalledWith(call.id, 'an', 'PA_an')
        expect(world.callPresence.get(call.id)!.find((one) => one.userId === 'an')!.leftAt).toEqual(at(60))
        expect(world.callJobs.checkMediaAt).toHaveBeenCalledWith(call.id, 2, at(90))
    })

    it('leaves the connections of other sessions', async () => {
        const { world, handler, ended } = setUp()

        await handler.handle(ended('session-elsewhere'))

        expect(world.callMedia.removeConnection).not.toHaveBeenCalled()
    })

    it('keeps the row when LiveKit cannot be asked, and goes on to the next', async () => {
        const { world, handler, call, ended } = setUp()
        world.callMedia.removeConnection.mockRejectedValueOnce(new Error('LiveKit down'))

        await handler.handle(ended('session-an', 'session-binh'))

        const rows = world.callPresence.get(call.id)!
        expect(rows.find((one) => one.userId === 'an')!.leftAt).toBeNull()
        expect(rows.find((one) => one.userId === 'binh')!.leftAt).toEqual(at(60))
    })

    it('reads nothing more when the rows cannot be read', async () => {
        const { world, handler, ended } = setUp()
        world.calls.inSessions = jest.fn().mockRejectedValueOnce(new Error('database down'))

        await expect(handler.handle(ended('session-an'))).resolves.toBeUndefined()
        expect(world.callMedia.removeConnection).not.toHaveBeenCalled()
    })
})
