import { CallRecord, CallStatus } from '../../../domain'
import { socialWorld } from '../../social-test-world.shared-spec'
import { CallChangedEvent } from '../call-changed.event'
import { CloseEndedCallRoomHandler } from './close-ended-call-room.handler'

function setUp() {
    const world = socialWorld()
    const handler = new CloseEndedCallRoomHandler(world.callMedia)
    const record = async (status: CallStatus): Promise<CallRecord> => {
        const row = world.callAs({ callerId: 'an', calleeId: 'binh', dmChannelId: 'dm-an-binh', status })
        return (await world.calls.find(row.id))!
    }
    return { world, handler, record }
}

describe('CloseEndedCallRoomHandler (D-242)', () => {
    it.each<CallStatus>(['ended', 'failed'])('closes the room of an active call now %s', async (status) => {
        const { world, handler, record } = setUp()
        const call = await record(status)

        await handler.handle(new CallChangedEvent(call, 'active'))

        expect(world.callMedia.close).toHaveBeenCalledWith(call.id)
    })

    it('leaves alone a call never answered (no room) and one answered now', async () => {
        const { world, handler, record } = setUp()

        await handler.handle(new CallChangedEvent(await record('missed'), 'ringing'))
        await handler.handle(new CallChangedEvent(await record('declined'), 'ringing'))
        await handler.handle(new CallChangedEvent(await record('active'), 'ringing'))

        expect(world.callMedia.close).not.toHaveBeenCalled()
    })

    it('keeps LiveKit unreachable to itself: the sweep closes the room', async () => {
        const { world, handler, record } = setUp()
        world.callMedia.close.mockRejectedValueOnce(new Error('LiveKit down'))

        await expect(handler.handle(new CallChangedEvent(await record('ended'), 'active'))).resolves.toBeUndefined()
    })
})
