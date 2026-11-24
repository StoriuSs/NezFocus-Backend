import { CommandBus } from '@nestjs/cqrs'
import { PostCallEndedCommand } from '@/modules/messaging'
import { Call, CallRecord } from '../../../domain'
import { socialWorld } from '../../social-test-world.shared-spec'
import { CallChangedEvent } from '../call-changed.event'
import { RecordCallEndHandler } from './record-call-end.handler'

function setUp() {
    const world = socialWorld()
    const commandBus = { execute: jest.fn(async () => undefined) } as unknown as CommandBus & { execute: jest.Mock }
    const handler = new RecordCallEndHandler(commandBus)
    const record = async (changes: Partial<Call>): Promise<CallRecord> => {
        const row = world.callAs({ callerId: 'an', calleeId: 'binh', dmChannelId: 'dm-an-binh', ...changes })
        return (await world.calls.find(row.id))!
    }
    /** The callee each posted message names as having missed the call. */
    const missedBy = () =>
        commandBus.execute.mock.calls.map(([command]) => (command as PostCallEndedCommand).missedCalleeId)
    return { commandBus, handler, record, missedBy }
}

const acceptedAt = new Date('2026-11-24T21:44:06Z')
const endedAt = new Date('2026-11-24T21:47:21Z')

describe('RecordCallEndHandler (REQ-MSG-08, REQ-SOCIAL-06, D-106, D-242)', () => {
    it('writes an ended call in its DM, as its caller’s, with its length, missed by no one', async () => {
        const { commandBus, handler, record } = setUp()
        const call = await record({ status: 'ended', acceptedAt, endedAt, video: true })

        await handler.handle(new CallChangedEvent(call, 'active'))

        expect(commandBus.execute).toHaveBeenCalledWith(
            new PostCallEndedCommand(
                'dm-an-binh',
                { userId: 'an', callId: call.id, status: 'ended', endReason: null, video: true, durationSeconds: 195 },
                null
            )
        )
    })

    it.each<[string, Partial<Call>]>([
        ['no answer', { status: 'missed', endReason: 'no_answer', endedAt }],
        ['its caller hung up', { status: 'missed', endReason: 'cancelled', endedAt }],
        ['its callee busy', { status: 'missed', endReason: 'busy', endedAt }]
    ])('names the callee of a missed call, for their item: %s (SOCIAL-06)', async (_, changes) => {
        const { handler, record, missedBy } = setUp()

        await handler.handle(new CallChangedEvent(await record(changes), 'ringing'))

        expect(missedBy()).toEqual(['binh'])
    })

    it('names no one for a declined call (SOCIAL-06), nor a failed one', async () => {
        const { handler, record, missedBy } = setUp()

        await handler.handle(new CallChangedEvent(await record({ status: 'declined', endedAt }), 'ringing'))
        await handler.handle(new CallChangedEvent(await record({ status: 'failed', acceptedAt, endedAt }), 'active'))

        expect(missedBy()).toEqual([null, null])
    })

    it('writes nothing for a call still open', async () => {
        const { commandBus, handler, record } = setUp()

        await handler.handle(new CallChangedEvent(await record({ status: 'ringing' }), null))
        await handler.handle(new CallChangedEvent(await record({ status: 'active', acceptedAt }), 'ringing'))

        expect(commandBus.execute).not.toHaveBeenCalled()
    })

    it('keeps a failure to itself', async () => {
        const { commandBus, handler, record } = setUp()
        commandBus.execute.mockRejectedValueOnce(new Error('database down'))

        await expect(
            handler.handle(new CallChangedEvent(await record({ status: 'declined', endedAt }), 'ringing'))
        ).resolves.toBeUndefined()
    })
})
