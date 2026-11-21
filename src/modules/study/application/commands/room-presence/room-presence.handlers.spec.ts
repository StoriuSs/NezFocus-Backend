import { FocusSessionChangedEvent } from '../../events/focus-session-changed.event'
import { RoomPresenceChangedEvent } from '../../events/room-presence-changed.event'
import { NOW, roomSession, soloSession, studyWorld } from '../../study-test-world.shared-spec'
import { JoinStudyRoomCommand, LeaveStudyRoomCommand } from './room-presence.commands'
import { JoinStudyRoomHandler, LeaveStudyRoomHandler } from './room-presence.handlers'

function setup() {
    const world = studyWorld()
    const sources = [world.repository, world.channels, world.checker, world.users, world.events] as const
    const join = new JoinStudyRoomHandler(...sources)
    const leave = new LeaveStudyRoomHandler(...sources)
    return {
        world,
        join: (userId: string, channelId = 'phong-hoc') => join.execute(new JoinStudyRoomCommand(channelId, userId)),
        leave: (userId: string, lost = false, channelId: string | null = 'phong-hoc') =>
            leave.execute(new LeaveStudyRoomCommand(channelId, userId, lost))
    }
}

/** The names of the events published, in order. */
const told = (world: ReturnType<typeof studyWorld>) => world.published().map((event) => event.constructor.name)

describe('JoinStudyRoomHandler', () => {
    it('makes one who comes into a room with a session take part, telling the room nothing', async () => {
        const { world, join } = setup()
        world.put(roomSession(), ['an'])
        await join('binh')
        expect(world.participants.get('phien')).toEqual(['an', 'binh'])
        expect(world.published()).toEqual([])
    })

    it('ends the Solo of one who comes into a room with a session, telling them, and they take part (D-103)', async () => {
        const { world, join } = setup()
        world.put(roomSession(), ['an'])
        world.put(soloSession({ userId: 'binh' }), ['binh'])
        await join('binh')
        expect(world.sessions.get('solo')).toMatchObject({ status: 'ended', endedReason: 'joined_room' })
        expect(world.participants.get('phien')).toEqual(['an', 'binh'])
        expect(told(world)).toEqual(['StudyCountedEvent', 'FocusSessionChangedEvent'])
        expect(world.published()[1]).toMatchObject({ action: 'end', after: { kind: 'solo' } })
        // Their zone read outside the transaction, only once a Solo is there to end.
        expect((world.repository.joinRoom as jest.Mock).mock.calls.map((call) => call[3])).toEqual([null, 'UTC'])
        expect((world.published()[0] as { count: { timeZone: string } }).count.timeZone).toBe('UTC')
    })

    it('keeps a Solo going in a room with no session (D-103)', async () => {
        const { world, join } = setup()
        world.put(soloSession({ userId: 'binh' }), ['binh'])
        await join('binh')
        expect(world.sessions.get('solo')?.status).toBe('running')
        expect(world.published()).toEqual([])
    })

    it('does nothing in a room with no session', async () => {
        const { world, join } = setup()
        await join('binh')
        expect(world.repository.joinRoom).toHaveBeenCalledTimes(1)
        expect(world.published()).toEqual([])
    })

    it('brings back one away within 3 minutes as never gone (D-215), and the room is no longer empty', async () => {
        const { world, join } = setup()
        world.put(roomSession({ emptySince: NOW }), ['an'])
        world.away.set('phien:an', NOW)
        await join('an')
        expect(world.away.size).toBe(0)
        expect(world.participants.get('phien')).toEqual(['an'])
        expect(world.sessions.get('phien')).toMatchObject({ emptySince: null, hostId: 'an', version: 0 })
    })

    it('makes Host the first who may start that comes into a room with none, asking only then (REQ-STUDY-03)', async () => {
        const { world, join } = setup()
        world.put(roomSession({ channelId: 'phong-thi', hostId: null }), [])
        // Phòng thi: only managers start. Bình may not, Chi may.
        await join('binh', 'phong-thi')
        expect(world.sessions.get('phien')).toMatchObject({ hostId: null, version: 0 })
        await join('chi', 'phong-thi')
        expect(world.sessions.get('phien')).toMatchObject({ hostId: 'chi', version: 1 })
        expect(told(world)).toEqual(['FocusSessionChangedEvent'])
        expect(world.published()[0]).toMatchObject({ action: 'host', actorId: null })
        expect(world.repository.joinRoom).toHaveBeenNthCalledWith(1, 'phong-thi', 'binh', null, null)
        expect(world.repository.joinRoom).toHaveBeenNthCalledWith(2, 'phong-thi', 'binh', false, null)
    })

    it('closes a place away in another room on coming into a room with no session too (D-215)', async () => {
        const { world, join } = setup()
        world.put(roomSession({ id: 'cu', channelId: 'phong-thi', hostId: 'binh' }), ['binh', 'chi'])
        world.away.set('cu:binh', NOW)
        await join('binh', 'tan-gau')
        expect(world.participants.get('cu')).toEqual(['chi'])
        expect(world.sessions.get('cu')).toMatchObject({ hostId: 'chi' })
    })

    it('closes a place still open in another room first, there, then joins (D-215)', async () => {
        const { world, join } = setup()
        world.put(roomSession({ id: 'cu', channelId: 'phong-thi', hostId: 'binh' }), ['binh', 'chi'])
        world.away.set('cu:binh', NOW)
        world.put(roomSession({ id: 'moi' }), ['an'])
        await join('binh')
        expect(world.participants.get('cu')).toEqual(['chi'])
        expect(world.sessions.get('cu')).toMatchObject({ hostId: 'chi', version: 1 })
        expect(world.participants.get('moi')).toEqual(['an', 'binh'])
        expect(told(world)).toEqual(['StudyCountedEvent', 'FocusSessionChangedEvent'])
    })
})

describe('LeaveStudyRoomHandler', () => {
    it('closes the place of one who left now, counted, and hands the Host to whoever came first (REQ-STUDY-03)', async () => {
        const { world, leave } = setup()
        world.put(roomSession(), ['an', 'phong', 'binh'])
        await leave('an')
        expect(world.participants.get('phien')).toEqual(['phong', 'binh'])
        expect(world.sessions.get('phien')).toMatchObject({ hostId: 'phong', version: 1 })
        expect(told(world)).toEqual(['StudyCountedEvent', 'FocusSessionChangedEvent'])
        const [, changed] = world.published() as FocusSessionChangedEvent[]
        expect(changed).toMatchObject({ action: 'host', actorId: null })
        expect(changed.after.hostId).toBe('phong')
    })

    it('keeps the place and the Host of one whose connection was lost, and starts the 3 minutes (D-215)', async () => {
        const { world, leave } = setup()
        world.put(roomSession(), ['an', 'binh'])
        await leave('an', true)
        expect(world.participants.get('phien')).toEqual(['an', 'binh'])
        expect(world.sessions.get('phien')).toMatchObject({ hostId: 'an', version: 0 })
        expect(world.published()).toEqual([
            new RoomPresenceChangedEvent('phien', { participationId: 'phien:an', since: NOW }, null)
        ])
        // Lost again while away: still away since then.
        await leave('an', true)
        expect(world.published()).toHaveLength(1)
    })

    it('closes the place away of one who asked to leave, whichever room, and hands the Host over (D-228)', async () => {
        const { world, leave } = setup()
        world.put(roomSession({ channelId: 'phong-thi', hostId: 'chi' }), ['chi', 'binh'])
        world.away.set('phien:chi', NOW)
        await leave('chi', false, null)
        expect(world.participants.get('phien')).toEqual(['binh'])
        expect(world.away.size).toBe(0)
        expect(world.repository.leave).toHaveBeenCalledWith(
            { anyRoom: true },
            'chi',
            false,
            expect.any(Function),
            expect.any(Function)
        )
        // Nobody may start Phòng thi now: no Host.
        expect(world.sessions.get('phien')).toMatchObject({ hostId: null, version: 1 })
    })

    it('starts the 5 minutes when nobody is present any more (D-227)', async () => {
        const { world, leave } = setup()
        world.put(roomSession(), ['an'])
        await leave('an', true)
        expect(world.published()).toEqual([
            new RoomPresenceChangedEvent('phien', { participationId: 'phien:an', since: NOW }, NOW)
        ])
    })

    it('leaves the session with no Host when nobody present may start (REQ-STUDY-03)', async () => {
        const { world, leave } = setup()
        world.put(roomSession({ channelId: 'phong-thi', hostId: 'chi' }), ['chi', 'binh'])
        await leave('chi', false, 'phong-thi')
        expect(world.sessions.get('phien')).toMatchObject({ hostId: null, version: 1 })
    })

    it('does nothing for one not in a session there', async () => {
        const { world, leave } = setup()
        world.put(roomSession(), ['an'])
        await leave('binh')
        await leave('an', false, 'tan-gau')
        expect(world.published()).toEqual([])
    })
})
