import { EventPublisherPort } from '@/modules/realtime'
import { Call, CallRecord } from '../../../domain'
import { socialWorld } from '../../social-test-world.shared-spec'
import { CallChangedEvent } from '../call-changed.event'
import { PublishCallChangeHandler } from './publish-call-change.handler'

function setUp() {
    const world = socialWorld()
    const told: { userId: string; event: string; data: Record<string, unknown> }[] = []
    const publisher = {
        toUser: jest.fn((userId: string, event: string, data: Record<string, unknown>) =>
            told.push({ userId, event, data })
        )
    } as unknown as EventPublisherPort
    const handler = new PublishCallChangeHandler(publisher, world.users)
    const record = async (changes: Partial<Call> = {}): Promise<CallRecord> => {
        const row = world.callAs({ callerId: 'an', calleeId: 'binh', dmChannelId: 'dm-an-binh', ...changes })
        return (await world.calls.find(row.id))!
    }
    /** Who heard what, and whom each saw on the other side. */
    const heard = () =>
        told.map(({ userId, event, data }) => [userId, event, (data.call as { user: { id: string } }).user.id])
    return { told, handler, record, heard }
}

describe('PublishCallChangeHandler (SRS 5.2, D-106, D-242)', () => {
    it('rings every tab of the callee, and tells the caller’s other tabs, each seeing the other one', async () => {
        const { handler, record, heard } = setUp()

        await handler.handle(new CallChangedEvent(await record(), null))

        expect(heard()).toEqual([
            ['binh', 'call.ringing', 'an'],
            ['an', 'call.updated', 'binh']
        ])
    })

    it('tells both when it is answered, and both when it is over', async () => {
        const { handler, record, heard } = setUp()
        const answered = await record({ status: 'active', acceptedAt: new Date('2026-11-24T08:00:03Z') })
        const over = await record({ status: 'ended', acceptedAt: new Date(), endedAt: new Date() })

        await handler.handle(new CallChangedEvent(answered, 'ringing'))
        await handler.handle(new CallChangedEvent(over, 'active'))

        expect(heard()).toEqual([
            ['an', 'call.updated', 'binh'],
            ['binh', 'call.updated', 'an'],
            ['an', 'call.ended', 'binh'],
            ['binh', 'call.ended', 'an']
        ])
    })

    it('tells only the caller of a call missed at once because its callee was busy: it never rang', async () => {
        const { handler, record, heard } = setUp()

        await handler.handle(
            new CallChangedEvent(await record({ status: 'missed', endReason: 'busy', endedAt: new Date() }), null)
        )

        expect(heard()).toEqual([['an', 'call.ended', 'binh']])
    })

    it('keeps a failure to itself', async () => {
        const { handler, record, told } = setUp()
        const call = await record()
        const broken = { ...call, caller: undefined } as unknown as CallRecord

        await expect(handler.handle(new CallChangedEvent(broken, null))).resolves.toBeUndefined()
        expect(told).toEqual([])
    })
})
