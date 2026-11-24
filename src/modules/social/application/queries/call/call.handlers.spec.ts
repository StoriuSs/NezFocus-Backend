import { socialWorld } from '../../social-test-world.shared-spec'
import { GetCallQuery, GetMyCallQuery } from './call.queries'
import { GetCallHandler, GetMyCallHandler } from './call.handlers'

async function setUp() {
    const world = socialWorld()
    const anBinh = (await world.dms.open('an', 'binh')).channelId
    const binhChi = (await world.dms.open('chi', 'binh')).channelId
    const anGiang = (await world.dms.open('an', 'giang')).channelId
    return { world, anBinh, binhChi, anGiang }
}

describe('GetCallHandler (D-159)', () => {
    it('reads a call of mine with the other one as I see them', async () => {
        const { world, anBinh } = await setUp()
        const call = world.callAs({ callerId: 'an', calleeId: 'binh', dmChannelId: anBinh, video: true })

        const asCallee = await new GetCallHandler(world.calls, world.users).execute(new GetCallQuery('binh', call.id))

        expect(asCallee).toEqual({
            id: call.id,
            dmId: anBinh,
            callerId: 'an',
            calleeId: 'binh',
            video: true,
            status: 'ringing',
            endReason: null,
            user: { id: 'an', username: 'an', displayName: 'AN', avatarUrl: 'https://cdn/an.png' },
            createdAt: call.createdAt,
            acceptedAt: null,
            endedAt: null
        })
    })

    it('shows an account waiting for deletion as deleted (D-182)', async () => {
        const { world, anGiang } = await setUp()
        const call = world.callAs({ callerId: 'giang', calleeId: 'an', dmChannelId: anGiang })

        const view = await new GetCallHandler(world.calls, world.users).execute(new GetCallQuery('an', call.id))

        expect(view?.user).toEqual({ id: 'giang', username: null, displayName: null, avatarUrl: null })
    })

    it('answers null for a call of two others, and for none', async () => {
        const { world, binhChi } = await setUp()
        const call = world.callAs({ callerId: 'chi', calleeId: 'binh', dmChannelId: binhChi })
        const handler = new GetCallHandler(world.calls, world.users)

        await expect(handler.execute(new GetCallQuery('an', call.id))).resolves.toBeNull()
        await expect(handler.execute(new GetCallQuery('an', 'call-none'))).resolves.toBeNull()
    })
})

describe('GetMyCallHandler (D-245)', () => {
    it('splits my open calls: the one I make or am in, and those ringing to me, oldest first', async () => {
        const { world, anBinh, binhChi } = await setUp()
        const first = world.callAs({
            callerId: 'an',
            calleeId: 'binh',
            dmChannelId: anBinh,
            createdAt: new Date('2026-11-24T08:00:00Z')
        })
        const second = world.callAs({
            callerId: 'chi',
            calleeId: 'binh',
            dmChannelId: binhChi,
            createdAt: new Date('2026-11-24T08:00:05Z')
        })
        const handler = new GetMyCallHandler(world.calls, world.users)

        const binh = await handler.execute(new GetMyCallQuery('binh'))
        const an = await handler.execute(new GetMyCallQuery('an'))

        expect(binh.current).toBeNull()
        expect(binh.incoming.map((call) => call.id)).toEqual([first.id, second.id])
        expect(an.current?.id).toBe(first.id)
        expect(an.incoming).toEqual([])
    })

    it('gives the active call as current, and nothing over', async () => {
        const { world, anBinh, binhChi } = await setUp()
        const talking = world.callAs({
            callerId: 'binh',
            calleeId: 'an',
            dmChannelId: anBinh,
            status: 'active',
            acceptedAt: new Date('2026-11-24T08:00:03Z')
        })
        world.callAs({
            callerId: 'chi',
            calleeId: 'binh',
            dmChannelId: binhChi,
            status: 'missed',
            endReason: 'busy',
            endedAt: new Date('2026-11-24T08:00:04Z')
        })

        const mine = await new GetMyCallHandler(world.calls, world.users).execute(new GetMyCallQuery('an'))

        expect(mine).toEqual({ current: expect.objectContaining({ id: talking.id, status: 'active' }), incoming: [] })
    })
})
