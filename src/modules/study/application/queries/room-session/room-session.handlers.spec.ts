import { roomSession, studyWorld } from '../../study-test-world.shared-spec'
import { ListRoomSessionsQuery } from './room-session.queries'
import { ListRoomSessionsHandler } from './room-session.handlers'

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
