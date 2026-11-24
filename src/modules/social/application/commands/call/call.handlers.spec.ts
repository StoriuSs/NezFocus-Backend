import {
    Call,
    CallInProgressError,
    CallNotFoundError,
    CallPresence,
    CannotMessageUserError,
    DmNotFoundError
} from '../../../domain'
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
        sweep: new SweepCallTimersHandler(world.calls, world.callJobs, world.callMedia, world.eventBus)
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

    it('gives the call answered its media job: 15 seconds from answering for both to connect (D-242)', async () => {
        const { world, handlers, anBinh, start } = await setUp()
        const callId = await start('an', anBinh)

        await handlers.accept.execute(new AcceptCallCommand('binh', callId))

        const row = world.callRows.get(callId)!
        expect(world.callJobs.checkMediaAt).toHaveBeenCalledWith(
            callId,
            row.version,
            new Date(row.acceptedAt!.getTime() + 15_000)
        )
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

    it('drops the media job of an active call that ends (D-242)', async () => {
        const { world, handlers, anBinh, start } = await setUp()
        const callId = await start('an', anBinh)
        await handlers.accept.execute(new AcceptCallCommand('binh', callId))
        const answeredAt = world.callRows.get(callId)!.version

        await handlers.end.execute(new EndCallCommand('an', callId))

        expect(world.callJobs.dropMediaCheck).toHaveBeenCalledWith(callId, answeredAt)
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

        await expect(handlers.sweep.execute(new SweepCallTimersCommand(now))).resolves.toMatchObject({ missed: 1 })

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

        await expect(handlers.sweep.execute(new SweepCallTimersCommand(now))).resolves.toMatchObject({ missed: 0 })
    })
})

describe('SweepCallTimersHandler: the call rooms (D-242, D-246)', () => {
    const acceptedAt = new Date('2026-11-24T21:44:06Z')
    const at = (seconds: number) => new Date(acceptedAt.getTime() + seconds * 1000)
    const now = at(200)

    async function roomsSetUp() {
        const { world, handlers, anBinh, binhChi } = await setUp()
        const call = (changes: Partial<Call> = {}, dm = anBinh, callerId = 'an') =>
            world.callAs({
                callerId,
                calleeId: 'binh',
                dmChannelId: dm,
                status: 'active',
                version: 1,
                createdAt: at(-10),
                acceptedAt,
                ...changes
            })
        const inRoom = (callId: string, userId: string, changes: Partial<CallPresence> = {}) => {
            const rows = world.callPresence.get(callId) ?? []
            rows.push({
                userId,
                participantSid: `PA_${userId}`,
                joinedAt: at(2),
                leftAt: null,
                sessionId: `session-${userId}`,
                ...changes
            })
            world.callPresence.set(callId, rows)
        }
        const sweep = () => handlers.sweep.execute(new SweepCallTimersCommand(now))
        return { world, anBinh, binhChi, call, inRoom, sweep }
    }

    it('runs a media deadline whose job was lost', async () => {
        const { world, call, inRoom, sweep } = await roomsSetUp()
        const { id } = call()
        inRoom(id, 'an')
        inRoom(id, 'binh', { leftAt: at(120) })

        await expect(sweep()).resolves.toMatchObject({ media: { timedOut: 1 } })
        expect(world.callRows.get(id)).toMatchObject({ status: 'ended', endedAt: at(120) })
    })

    it('writes the joins and leaves LiveKit has and the webhooks lost, setting the media job again', async () => {
        const { world, call, inRoom, sweep } = await roomsSetUp()
        const { id } = call()
        inRoom(id, 'an')
        inRoom(id, 'binh')
        // An's connection gone with no webhook; Bình reloaded, their new connection's webhook lost.
        world.liveRooms.set(id, [{ userId: 'binh', participantSid: 'PA_binh_2', joinedAt: at(160), sessionId: null }])

        await expect(sweep()).resolves.toMatchObject({ media: { fixed: 3, timedOut: 0, closed: 0 } })

        expect(world.callPresence.get(id)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ userId: 'an', leftAt: now }),
                expect.objectContaining({ userId: 'binh', participantSid: 'PA_binh_2', leftAt: null })
            ])
        )
        // An out at 200: the call ends at 230 unless they come back.
        expect(world.callJobs.checkMediaAt).toHaveBeenLastCalledWith(id, 4, at(230))
    })

    it('puts out of a call room someone not of the call', async () => {
        const { world, call, inRoom, sweep } = await roomsSetUp()
        const { id } = call()
        inRoom(id, 'an')
        inRoom(id, 'binh')
        world.liveRooms.set(id, [
            { userId: 'an', participantSid: 'PA_an', joinedAt: at(2), sessionId: null },
            { userId: 'binh', participantSid: 'PA_binh', joinedAt: at(2), sessionId: null },
            { userId: 'chi', participantSid: 'PA_chi', joinedAt: at(3), sessionId: null }
        ])

        await sweep()

        expect(world.callMedia.removeConnection).toHaveBeenCalledWith(id, 'chi', 'PA_chi')
        expect(world.callPresence.get(id)).toHaveLength(2)
    })

    it('closes a room no active call has, and keeps the room of one active', async () => {
        const { world, call, inRoom, sweep } = await roomsSetUp()
        const over = call({ status: 'ended', endedAt: at(9) })
        const active = call()
        inRoom(active.id, 'an')
        inRoom(active.id, 'binh')
        world.liveRooms.set(over.id, [])
        world.liveRooms.set('call-gone', [])
        world.liveRooms.set(active.id, [
            { userId: 'an', participantSid: 'PA_an', joinedAt: at(2), sessionId: null },
            { userId: 'binh', participantSid: 'PA_binh', joinedAt: at(2), sessionId: null }
        ])

        await expect(sweep()).resolves.toMatchObject({ media: { closed: 2 } })
        expect(world.callMedia.close.mock.calls).toEqual([[over.id], ['call-gone']])
    })

    it('still runs the media deadlines and the ring-outs when LiveKit cannot be reached', async () => {
        const { world, anBinh, binhChi, call, inRoom, sweep } = await roomsSetUp()
        const rung = world.callAs({ callerId: 'chi', calleeId: 'binh', dmChannelId: binhChi, createdAt: at(100) })
        const { id } = call({}, anBinh)
        inRoom(id, 'an')
        world.callMedia.rooms.mockRejectedValue(new Error('LiveKit down'))
        world.callMedia.participants.mockRejectedValue(new Error('LiveKit down'))

        await expect(sweep()).resolves.toMatchObject({ missed: 1, media: { timedOut: 1, fixed: 0, closed: 0 } })
        expect(world.callRows.get(rung.id)!.status).toBe('missed')
        expect(world.callRows.get(id)!.status).toBe('failed')
    })

    it('goes on to the next call when the room of one cannot be read', async () => {
        const { world, call, inRoom, sweep } = await roomsSetUp()
        const first = call()
        inRoom(first.id, 'an')
        inRoom(first.id, 'binh')
        const second = world.callAs({
            callerId: 'chi',
            calleeId: 'dung',
            dmChannelId: 'dm-chi-dung',
            status: 'active',
            version: 1,
            createdAt: at(-10),
            acceptedAt
        })
        inRoom(second.id, 'chi')
        inRoom(second.id, 'dung')
        world.callMedia.participants.mockRejectedValueOnce(new Error('LiveKit hiccup'))

        await expect(sweep()).resolves.toMatchObject({ media: { fixed: 2 } })
        // The first left as it was; the second's two, gone from LiveKit, marked out.
        expect(world.callPresence.get(first.id)!.every((row) => row.leftAt === null)).toBe(true)
        expect(world.callPresence.get(second.id)!.every((row) => row.leftAt !== null)).toBe(true)
    })
})
