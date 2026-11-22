import { NOW, roomSession, soloSession, studyWorld } from '../../study-test-world.shared-spec'
import { GetNextHostQuery, ListRoomSessionsQuery } from './room-session.queries'
import { GetNextHostHandler, ListRoomSessionsHandler } from './room-session.handlers'

describe('ListRoomSessionsHandler', () => {
    it('gives the session not yet ended of each room asked for, as the clients get it, with one clock', async () => {
        const world = studyWorld()
        world.put(roomSession())
        world.put(roomSession({ id: 'cu', channelId: 'phong-thi', status: 'ended', phaseEndsAt: null }))
        const sessions = await new ListRoomSessionsHandler(world.repository).execute(
            new ListRoomSessionsQuery(['phong-hoc', 'phong-thi', 'tan-gau'])
        )
        expect([...sessions.keys()]).toEqual(['phong-hoc'])
        expect(sessions.get('phong-hoc')).toMatchObject({
            id: 'phien',
            focusMinutes: 25,
            stretchStartedAt: expect.any(Date),
            serverTime: expect.any(Date)
        })
    })
})

describe('GetNextHostHandler (REQ-STUDY-03, D-233)', () => {
    function setup() {
        const world = studyWorld()
        const handler = new GetNextHostHandler(world.repository, world.channels, world.checker, world.users)
        return {
            world,
            ask: (userId: string, sessionId = 'phien') => handler.execute(new GetNextHostQuery(userId, sessionId))
        }
    }
    const refusal = (done: Promise<unknown>) =>
        done.then(
            () => 'done',
            (error: { errorKey: string; details?: { reason?: string } }) =>
                [error.errorKey, error.details?.reason].filter(Boolean).join(' ')
        )

    it('names who would control the session if the Host left now: the first present who may start, not the Host, not one away', async () => {
        const { world, ask } = setup()
        world.put(roomSession(), ['an', 'binh', 'phong'])
        world.away.set('phien:binh', NOW)
        expect(await ask('an')).toEqual({ id: 'phong', displayName: 'Phong' })
    })

    it('skips who may not start, and says null when nobody present may (REQ-STUDY-03)', async () => {
        const { world, ask } = setup()
        // Phòng thi: only managers start. Chi is the Host; Bình and Phong may not.
        world.put(roomSession({ channelId: 'phong-thi', hostId: 'chi' }), ['binh', 'chi', 'phong'])
        expect(await ask('chi')).toBeNull()
        world.put(roomSession({ channelId: 'phong-thi', hostId: 'binh' }), ['binh', 'phong', 'chi'])
        // Bình is Host here only for the question: Chi, who came last, is the one who may.
        expect(await ask('binh')).toEqual({ id: 'chi', displayName: 'Chi' })
    })

    it('gives no name for an account waiting to be deleted (D-182)', async () => {
        const { world, ask } = setup()
        world.put(roomSession(), ['an', 'binh'])
        world.users.findById.mockResolvedValueOnce({
            id: 'binh',
            username: 'binh',
            displayName: 'Bình',
            deletedAt: null,
            deletionRequestedAt: NOW
        })
        expect(await ask('an')).toEqual({ id: 'binh', displayName: null })
    })

    it('answers only the Host; a session one may not see, ended, a Solo or none is not found (NFR-SEC-05)', async () => {
        const { world, ask } = setup()
        world.put(roomSession(), ['an', 'binh'])
        world.put(roomSession({ id: 'cu', status: 'ended', phaseEndsAt: null }), [])
        world.put(soloSession({ userId: 'an' }), ['an'])
        expect(await refusal(ask('binh'))).toBe('FORBIDDEN not_host')
        // A manager is not the Host either: the question is the Host's (D-44).
        expect(await refusal(ask('chi'))).toBe('FORBIDDEN not_host')
        expect(await refusal(ask('khach'))).toBe('NOT_FOUND')
        expect(await refusal(ask('an', 'cu'))).toBe('NOT_FOUND')
        expect(await refusal(ask('an', 'solo'))).toBe('NOT_FOUND')
        expect(await refusal(ask('an', 'none'))).toBe('NOT_FOUND')
    })
})
