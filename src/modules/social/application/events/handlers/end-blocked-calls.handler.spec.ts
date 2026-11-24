import { AccountDeletionRequestedEvent } from '@/modules/auth'
import { PairState } from '../../../domain'
import { socialWorld } from '../../social-test-world.shared-spec'
import { RelationshipChangedEvent } from '../relationship-changed.event'
import { EndBlockedCallsHandler } from './end-blocked-calls.handler'
import { EndDeletedAccountCallsHandler } from './end-deleted-account-calls.handler'

const friends: PairState = { standing: 'friend', blocking: false, blockedBy: false }
const blocked: PairState = { standing: 'none', blocking: true, blockedBy: false }

function setUp() {
    const world = socialWorld()
    const talking = world.callAs({
        callerId: 'an',
        calleeId: 'binh',
        dmChannelId: 'dm-an-binh',
        status: 'active',
        acceptedAt: new Date('2026-11-24T08:00:03Z')
    })
    const ringing = world.callAs({ callerId: 'chi', calleeId: 'dung', dmChannelId: 'dm-chi-dung' })
    return { world, talking, ringing }
}

describe('EndBlockedCallsHandler (D-242)', () => {
    it('ends the call between the two at once, whoever blocked whom', async () => {
        const { world, talking, ringing } = setUp()
        const handler = new EndBlockedCallsHandler(world.calls, world.callJobs, world.eventBus)

        await handler.handle(new RelationshipChangedEvent('binh', 'an', friends, blocked, { write: 'block' }))

        expect(world.callRows.get(talking.id)).toMatchObject({ status: 'ended', endedAt: expect.any(Date) })
        expect(world.callRows.get(ringing.id)!.status).toBe('ringing')
    })

    it('misses a call still ringing across the block, as cancelled', async () => {
        const { world, ringing } = setUp()
        const handler = new EndBlockedCallsHandler(world.calls, world.callJobs, world.eventBus)

        await handler.handle(new RelationshipChangedEvent('dung', 'chi', friends, blocked, { write: 'block' }))

        expect(world.callRows.get(ringing.id)).toMatchObject({ status: 'missed', endReason: 'cancelled' })
    })

    it('leaves the call of two who only stopped being friends', async () => {
        const { world, talking } = setUp()
        const handler = new EndBlockedCallsHandler(world.calls, world.callJobs, world.eventBus)
        const none: PairState = { standing: 'none', blocking: false, blockedBy: false }

        await handler.handle(new RelationshipChangedEvent('an', 'binh', friends, none, { write: 'remove' }))

        expect(world.callRows.get(talking.id)!.status).toBe('active')
    })

    it('keeps a failure to itself', async () => {
        const { world } = setUp()
        world.calls.change.mockRejectedValueOnce(new Error('database down'))
        const handler = new EndBlockedCallsHandler(world.calls, world.callJobs, world.eventBus)

        await expect(
            handler.handle(new RelationshipChangedEvent('an', 'binh', friends, blocked, { write: 'block' }))
        ).resolves.toBeUndefined()
    })
})

describe('EndDeletedAccountCallsHandler (REQ-AUTH-09, D-242)', () => {
    it('ends every open call of an account starting to wait for deletion, and no other', async () => {
        const { world, talking, ringing } = setUp()
        const handler = new EndDeletedAccountCallsHandler(world.calls, world.callJobs, world.eventBus)

        await handler.handle(new AccountDeletionRequestedEvent('binh'))

        expect(world.callRows.get(talking.id)!.status).toBe('ended')
        expect(world.callRows.get(ringing.id)!.status).toBe('ringing')
    })

    it('still ends the others when one fails: an active call has no timer to end it later', async () => {
        const { world, talking } = setUp()
        const ringing = world.callAs({ callerId: 'dung', calleeId: 'binh', dmChannelId: 'dm-binh-dung' })
        world.calls.change.mockRejectedValueOnce(new Error('database down'))
        const handler = new EndDeletedAccountCallsHandler(world.calls, world.callJobs, world.eventBus)

        await handler.handle(new AccountDeletionRequestedEvent('binh'))

        expect(world.callRows.get(talking.id)!.status).toBe('active')
        expect(world.callRows.get(ringing.id)).toMatchObject({ status: 'missed', endReason: 'cancelled' })
    })

    it('keeps a failure to itself', async () => {
        const { world } = setUp()
        world.calls.change.mockRejectedValueOnce(new Error('database down'))
        const handler = new EndDeletedAccountCallsHandler(world.calls, world.callJobs, world.eventBus)

        await expect(handler.handle(new AccountDeletionRequestedEvent('binh'))).resolves.toBeUndefined()
    })
})
