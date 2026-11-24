import { CallInProgressError, CallNotFoundError, CannotMessageUserError, DmNotFoundError } from '../../../domain'
import { CallChangedEvent } from '../../events/call-changed.event'
import { socialWorld } from '../../social-test-world.shared-spec'
import {
    AcceptCallCommand,
    DeclineCallCommand,
    EndCallCommand,
    RingOutCallCommand,
    StartCallCommand,
    SweepCallTimersCommand
} from './call.commands'
import {
    AcceptCallHandler,
    DeclineCallHandler,
    EndCallHandler,
    RingOutCallHandler,
    StartCallHandler,
    SweepCallTimersHandler
} from './call.handlers'

/*
 * An and Bình share the server "ot", Bình and Chi the server "nd": each of
 * those pairs may message the other (everyone lets server members write).
 * An and Chi share nothing.
 */
async function setUp() {
    const world = socialWorld()
    const deps = [
        world.calls,
        world.callJobs,
        world.dms,
        world.relationships,
        world.membership,
        world.users,
        world.eventBus
    ] as const
    const handlers = {
        start: new StartCallHandler(...deps),
        accept: new AcceptCallHandler(...deps),
        decline: new DeclineCallHandler(...deps),
        end: new EndCallHandler(...deps),
        ringOut: new RingOutCallHandler(...deps),
        sweep: new SweepCallTimersHandler(...deps)
    }
    const anBinh = (await world.dms.open('an', 'binh')).channelId
    const binhChi = (await world.dms.open('chi', 'binh')).channelId
    const anChi = (await world.dms.open('an', 'chi')).channelId
    /** Each call's changes, as `id status (reason)` from what was published. */
    const told = () =>
        world
            .published(CallChangedEvent)
            .map(
                ({ call, before }) =>
                    `${call.callerId}→${call.calleeId} ${before ?? 'new'}→${call.status}${call.endReason ? ` (${call.endReason})` : ''}`
            )
    const start = (userId: string, dm: string) =>
        handlers.start.execute(new StartCallCommand(userId, dm, false)).then(({ callId }) => callId)
    return { world, handlers, anBinh, binhChi, anChi, told, start }
}

describe('StartCallHandler (REQ-SOCIAL-05, D-120, D-242, D-245)', () => {
    it('rings someone I may message, its 45-second job set from its ringing', async () => {
        const { world, anBinh, told, start } = await setUp()

        const callId = await start('an', anBinh)

        const row = world.callRows.get(callId)!
        expect(row).toMatchObject({ callerId: 'an', calleeId: 'binh', status: 'ringing', video: false, version: 0 })
        expect(told()).toEqual(['an→binh new→ringing'])
        expect(world.callJobs.ringOutAt).toHaveBeenCalledWith(callId, 0, new Date(row.createdAt.getTime() + 45_000))
    })

    it('makes a call to someone busy (ringing out) missed at once (busy): no ring, no job', async () => {
        const { world, anBinh, binhChi, told, start } = await setUp()
        await start('binh', binhChi)

        const callId = await start('an', anBinh)

        expect(world.callRows.get(callId)).toMatchObject({ status: 'missed', endReason: 'busy' })
        expect(told()).toEqual(['binh→chi new→ringing', 'an→binh new→missed (busy)'])
        expect(world.callJobs.ringOutAt).toHaveBeenCalledTimes(1)
    })

    it('answers the call ringing to me when I call its caller back in the same DM (two calling at once)', async () => {
        const { world, anBinh, told, start } = await setUp()
        const theirs = await start('binh', anBinh)

        expect(await start('an', anBinh)).toBe(theirs)
        expect(world.callRows.get(theirs)).toMatchObject({ status: 'active', version: 1 })
        expect(told()).toEqual(['binh→an new→ringing', 'binh→an ringing→active'])
        expect(world.callJobs.dropRingOut).toHaveBeenCalledWith(theirs, 0)
    })

    it('misses as busy the call ringing to me when I call someone else (D-245)', async () => {
        const { world, anBinh, binhChi, start } = await setUp()
        const toBinh = await start('chi', binhChi)

        await start('binh', anBinh)

        expect(world.callRows.get(toBinh)).toMatchObject({ status: 'missed', endReason: 'busy' })
    })

    it('refuses me while I make or am in another call (CALL_IN_PROGRESS)', async () => {
        const { anBinh, binhChi, start } = await setUp()
        await start('binh', binhChi)

        await expect(start('binh', anBinh)).rejects.toThrow(CallInProgressError)
    })

    it.each<[string, (world: ReturnType<typeof socialWorld>) => void]>([
        ['someone I share no server with and am not friends with', () => undefined],
        ['a friend who blocked me', (world) => (world.befriend('an', 'chi'), world.block('chi', 'an'))],
        ['a friend I blocked', (world) => (world.befriend('an', 'chi'), world.block('an', 'chi'))]
    ])('refuses to call %s with CANNOT_MESSAGE_USER, writing nothing', async (_, arrange) => {
        const { world, anChi, start } = await setUp()
        arrange(world)

        await expect(start('an', anChi)).rejects.toThrow(CannotMessageUserError)
        expect(world.calls.change).not.toHaveBeenCalled()
    })

    it('cuts off a call made just as the other one blocked me: who may call is asked again once it rings', async () => {
        const { world, anBinh, start } = await setUp()
        const write = world.calls.change.getMockImplementation()!
        world.calls.change.mockImplementationOnce(async (userIds, decide) => {
            // The block commits between the first check and the call's write; its handler saw no call yet.
            world.block('binh', 'an')
            return write(userIds, decide)
        })

        const callId = await start('an', anBinh)

        expect(world.callRows.get(callId)).toMatchObject({ status: 'missed', endReason: 'cancelled' })
    })

    it('finds no DM that is not mine, the same as none', async () => {
        const { binhChi, start } = await setUp()

        await expect(start('an', binhChi)).rejects.toThrow(DmNotFoundError)
        await expect(start('an', 'dm-none')).rejects.toThrow(DmNotFoundError)
    })

    it('keeps the call when its job cannot be set: the sweep misses it in time', async () => {
        const { world, anBinh, start } = await setUp()
        world.callJobs.ringOutAt.mockRejectedValueOnce(new Error('Redis down'))

        const callId = await start('an', anBinh)

        expect(world.callRows.get(callId)!.status).toBe('ringing')
    })
})

describe('AcceptCallHandler', () => {
    it('makes the call active and misses as busy the other one ringing to me (D-120)', async () => {
        const { world, handlers, anBinh, binhChi, told, start } = await setUp()
        const fromAn = await start('an', anBinh)
        const fromChi = await start('chi', binhChi)

        await handlers.accept.execute(new AcceptCallCommand('binh', fromAn))

        expect(world.callRows.get(fromAn)).toMatchObject({ status: 'active', acceptedAt: expect.any(Date) })
        expect(world.callRows.get(fromChi)).toMatchObject({ status: 'missed', endReason: 'busy' })
        expect(told().slice(2)).toEqual(['an→binh ringing→active', 'chi→binh ringing→missed (busy)'])
    })

    it('refuses one I may no longer message (blocked while it rang), the call left ringing', async () => {
        const { world, handlers, anBinh, start } = await setUp()
        const callId = await start('an', anBinh)
        world.block('an', 'binh')

        await expect(handlers.accept.execute(new AcceptCallCommand('binh', callId))).rejects.toThrow(
            CannotMessageUserError
        )
        expect(world.callRows.get(callId)!.status).toBe('ringing')
    })

    it.each<[string, string]>([
        ['its caller', 'an'],
        ['its callee, once it was cancelled', 'binh']
    ])('changes nothing for %s (D-245)', async (_, userId) => {
        const { world, handlers, anBinh, start } = await setUp()
        const callId = await start('an', anBinh)
        if (userId === 'binh') await handlers.end.execute(new EndCallCommand('an', callId))
        const before = world.callRows.get(callId)

        await handlers.accept.execute(new AcceptCallCommand(userId, callId))

        expect(world.callRows.get(callId)).toEqual(before)
    })

    it('finds no call of two others, the same as none (NFR-SEC-05)', async () => {
        const { handlers, binhChi, start } = await setUp()
        const callId = await start('chi', binhChi)

        await expect(handlers.accept.execute(new AcceptCallCommand('an', callId))).rejects.toThrow(CallNotFoundError)
        await expect(handlers.accept.execute(new AcceptCallCommand('an', 'call-none'))).rejects.toThrow(
            CallNotFoundError
        )
    })
})

describe('DeclineCallHandler and EndCallHandler (D-242)', () => {
    it('declines a call ringing to me', async () => {
        const { world, handlers, anBinh, start } = await setUp()
        const callId = await start('an', anBinh)

        await handlers.decline.execute(new DeclineCallCommand('binh', callId))

        expect(world.callRows.get(callId)).toMatchObject({ status: 'declined', endReason: null })
        expect(world.callJobs.dropRingOut).toHaveBeenCalledWith(callId, 0)
    })

    it.each<[string, string, boolean, string]>([
        ['its caller hanging up while it rings: cancelled', 'an', false, 'missed'],
        ['its callee hanging up while it rings: declined', 'binh', false, 'declined'],
        ['either hanging up once active: ended', 'binh', true, 'ended']
    ])('ends a call: %s', async (_, userId, answered, status) => {
        const { world, handlers, anBinh, start } = await setUp()
        const callId = await start('an', anBinh)
        if (answered) await handlers.accept.execute(new AcceptCallCommand('binh', callId))

        await handlers.end.execute(new EndCallCommand(userId, callId))

        expect(world.callRows.get(callId)).toMatchObject({ status, endedAt: expect.any(Date) })
    })

    it('changes nothing when the other one hung up first (D-245)', async () => {
        const { world, handlers, anBinh, start } = await setUp()
        const callId = await start('an', anBinh)
        await handlers.accept.execute(new AcceptCallCommand('binh', callId))
        await handlers.end.execute(new EndCallCommand('an', callId))
        world.eventBus.publish.mockClear()

        await handlers.end.execute(new EndCallCommand('binh', callId))

        expect(world.eventBus.publish).not.toHaveBeenCalled()
    })
})

describe('RingOutCallHandler and SweepCallTimersHandler (45 seconds)', () => {
    it('misses a call still ringing at the version its job was set for (no_answer)', async () => {
        const { world, handlers, anBinh, start } = await setUp()
        const callId = await start('an', anBinh)

        await expect(handlers.ringOut.execute(new RingOutCallCommand(callId, 0))).resolves.toBe(true)

        expect(world.callRows.get(callId)).toMatchObject({ status: 'missed', endReason: 'no_answer' })
    })

    it('does nothing for a job of a version gone by, or a call answered', async () => {
        const { world, handlers, anBinh, start } = await setUp()
        const callId = await start('an', anBinh)
        await handlers.accept.execute(new AcceptCallCommand('binh', callId))
        world.eventBus.publish.mockClear()

        await expect(handlers.ringOut.execute(new RingOutCallCommand(callId, 0))).resolves.toBe(false)
        await expect(handlers.ringOut.execute(new RingOutCallCommand('call-none', 0))).resolves.toBe(false)
        expect(world.eventBus.publish).not.toHaveBeenCalled()
    })

    it('counts no ring-out for a call its caller hung up on just before, under the locks', async () => {
        const { world, handlers, anBinh, start } = await setUp()
        const callId = await start('an', anBinh)
        const write = world.calls.change.getMockImplementation()!
        world.calls.change.mockImplementationOnce(async (userIds, decide) => {
            // The hang-up takes the locks first; the job then reads the call as it is.
            await handlers.end.execute(new EndCallCommand('an', callId))
            return write(userIds, decide)
        })

        await expect(handlers.ringOut.execute(new RingOutCallCommand(callId, 0))).resolves.toBe(false)
        expect(world.callRows.get(callId)).toMatchObject({ status: 'missed', endReason: 'cancelled' })
    })

    it('misses the calls ringing 45 seconds or more whose job was lost, none younger', async () => {
        const { world, handlers, anBinh, binhChi } = await setUp()
        const now = new Date('2026-11-24T09:00:00Z')
        const old = world.callAs({
            callerId: 'an',
            calleeId: 'binh',
            dmChannelId: anBinh,
            createdAt: new Date(now.getTime() - 46_000)
        })
        const young = world.callAs({
            callerId: 'chi',
            calleeId: 'binh',
            dmChannelId: binhChi,
            createdAt: new Date(now.getTime() - 10_000)
        })

        await expect(handlers.sweep.execute(new SweepCallTimersCommand(now))).resolves.toBe(1)

        expect(world.callRows.get(old.id)).toMatchObject({ status: 'missed', endReason: 'no_answer', endedAt: now })
        expect(world.callRows.get(young.id)!.status).toBe('ringing')
    })

    it('keeps sweeping when one call fails, and logs it', async () => {
        const { world, handlers, anBinh } = await setUp()
        const now = new Date('2026-11-24T09:00:00Z')
        world.callAs({
            callerId: 'an',
            calleeId: 'binh',
            dmChannelId: anBinh,
            createdAt: new Date(now.getTime() - 60_000)
        })
        world.calls.change.mockRejectedValueOnce(new Error('database down'))

        await expect(handlers.sweep.execute(new SweepCallTimersCommand(now))).resolves.toBe(0)
    })
})
