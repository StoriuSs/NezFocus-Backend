import { FocusSessionChangedEvent } from '../../events/focus-session-changed.event'
import { ParticipationOpenedEvent } from '../../events/participation-opened.event'
import { RoomPresenceChangedEvent } from '../../events/room-presence-changed.event'
import { MINUTE, NOW, roomSession, soloSession, studyWorld } from '../../study-test-world.shared-spec'
import {
    CloseAwayCommand,
    EndEmptyRoomCommand,
    EndFocusPhaseCommand,
    SweepStudyTimersCommand
} from './session-timer.commands'
import {
    CloseAwayHandler,
    EndEmptyRoomHandler,
    EndFocusPhaseHandler,
    SweepStudyTimersHandler
} from './session-timer.handlers'

const later = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE)

function setup() {
    const world = studyWorld()
    const end = new EndFocusPhaseHandler(world.repository, world.users, world.settings, world.events)
    const sweep = new SweepStudyTimersHandler(
        world.repository,
        world.channels,
        world.checker,
        world.voiceRooms,
        world.users,
        world.settings,
        world.events
    )
    const closeAway = new CloseAwayHandler(
        world.repository,
        world.channels,
        world.checker,
        world.users,
        world.settings,
        world.events
    )
    const endEmpty = new EndEmptyRoomHandler(world.repository, world.users, world.settings, world.events)
    return { world, end, sweep, closeAway, endEmpty }
}

describe('EndFocusPhaseHandler', () => {
    it('begins the break when the focus phase was due, counting it, told as a phase end by no one', async () => {
        const { world, end } = setup()
        world.put(roomSession())
        world.at(later(25.2))
        await end.execute(new EndFocusPhaseCommand('phien', 0))
        expect(world.sessions.get('phien')).toMatchObject({
            phase: 'short_break',
            phaseStartedAt: later(25),
            phaseEndsAt: later(30),
            version: 1
        })
        const changed = world.published().at(-1) as FocusSessionChangedEvent
        expect(changed).toMatchObject({ action: 'phase_end', actorId: null })
        expect(world.published().filter((event) => event.constructor.name === 'StudyCountedEvent')).toHaveLength(2)
    })

    it('makes a Solo wait 10 minutes when its break ends (REQ-STUDY-05)', async () => {
        const { world, end } = setup()
        world.put(
            soloSession({
                phase: 'short_break',
                phaseIndex: 1,
                phaseStartedAt: later(25),
                phaseEndsAt: later(30),
                stretchStartedAt: null
            }),
            ['an']
        )
        world.at(later(30))
        await end.execute(new EndFocusPhaseCommand('solo', 0))
        expect(world.sessions.get('solo')).toMatchObject({ status: 'waiting', waitingUntil: later(40), version: 1 })
    })

    it('ends a Solo not taken up within its wait as expired, at the end of its break; a job run early does nothing', async () => {
        const { world, end } = setup()
        world.put(
            soloSession({
                status: 'waiting',
                phase: 'short_break',
                phaseIndex: 1,
                phaseStartedAt: later(25),
                phaseEndsAt: null,
                waitingUntil: later(40),
                stretchStartedAt: null
            }),
            ['an']
        )
        world.at(later(38))
        await end.execute(new EndFocusPhaseCommand('solo', 0))
        expect(world.sessions.get('solo')?.status).toBe('waiting')
        world.at(later(40))
        await end.execute(new EndFocusPhaseCommand('solo', 0))
        expect(world.sessions.get('solo')).toMatchObject({
            status: 'ended',
            endedReason: 'expired',
            endedAt: later(30)
        })
        expect(world.published().at(-1)).toMatchObject({ action: 'phase_end', actorId: null })
    })

    it('does nothing for a version gone by, a session not running, or none', async () => {
        const { world, end } = setup()
        world.put(roomSession({ version: 3 }))
        await end.execute(new EndFocusPhaseCommand('phien', 2))
        await end.execute(new EndFocusPhaseCommand('khong-co', 0))
        world.put(roomSession({ id: 'dung-lai', status: 'paused', phaseEndsAt: null, pausedRemainingMs: MINUTE }))
        await end.execute(new EndFocusPhaseCommand('dung-lai', 0))
        expect(world.published()).toEqual([])
    })
})

describe('EndFocusPhaseHandler, run early', () => {
    it('leaves a phase alone more than a second before it is due, and ends one due within it', async () => {
        const { world, end } = setup()
        world.put(roomSession())
        world.at(later(24.9))
        await end.execute(new EndFocusPhaseCommand('phien', 0))
        expect(world.sessions.get('phien')).toMatchObject({ phase: 'focus', version: 0 })
        world.at(new Date(later(25).getTime() - 500))
        await end.execute(new EndFocusPhaseCommand('phien', 0))
        expect(world.sessions.get('phien')).toMatchObject({ phase: 'short_break', phaseStartedAt: later(25) })
    })
})

describe('SweepStudyTimersHandler', () => {
    it('runs the phase ends already due, at the version each has, and counts those that moved (D-225)', async () => {
        const { world, sweep } = setup()
        world.put(roomSession({ id: 'qua-han' }))
        world.put(roomSession({ id: 'chua-toi', channelId: 'phong-thi', phaseEndsAt: later(40) }))
        world.at(later(26))
        expect(await sweep.execute(new SweepStudyTimersCommand(later(26)))).toBe(1)
        expect(world.sessions.get('qua-han')).toMatchObject({ phase: 'short_break', version: 1 })
        expect(world.sessions.get('chua-toi')).toMatchObject({ phase: 'focus', version: 0 })
    })

    it('ends a Solo whose wait is over and its job lost, as expired (REQ-STUDY-05)', async () => {
        const { world, sweep } = setup()
        const waiting = {
            status: 'waiting' as const,
            phase: 'short_break' as const,
            phaseIndex: 1,
            phaseStartedAt: later(25),
            phaseEndsAt: null,
            stretchStartedAt: null
        }
        world.put(soloSession({ ...waiting, waitingUntil: later(40) }), ['an'])
        world.put(soloSession({ ...waiting, id: 'con-cho', userId: 'binh', waitingUntil: later(45) }), ['binh'])
        world.at(later(41))
        expect(await sweep.execute(new SweepStudyTimersCommand(later(41)))).toBe(1)
        expect(world.sessions.get('solo')).toMatchObject({ status: 'ended', endedReason: 'expired' })
        expect(world.sessions.get('con-cho')?.status).toBe('waiting')
    })

    it('goes on past a session whose phase end fails, leaving it for the next run', async () => {
        const { world, sweep } = setup()
        world.put(roomSession({ id: 'hong' }))
        world.put(roomSession({ id: 'tot', channelId: 'phong-thi' }))
        world.at(later(26))
        const change = world.repository.change as jest.Mock
        const real = change.getMockImplementation()!
        change.mockImplementation((id: string, ...rest: unknown[]) =>
            id === 'hong' ? Promise.reject(new Error('CHECK failed')) : real(id, ...rest)
        )
        expect(await sweep.execute(new SweepStudyTimersCommand(later(26)))).toBe(1)
        expect(world.sessions.get('tot')).toMatchObject({ phase: 'short_break' })
        expect(world.sessions.get('hong')).toMatchObject({ phase: 'focus' })
    })

    it('counts none that another run moved meanwhile', async () => {
        const { world, sweep } = setup()
        world.put(roomSession())
        ;(world.repository.overdue as jest.Mock).mockResolvedValueOnce([{ id: 'phien', version: 9 }])
        expect(await sweep.execute(new SweepStudyTimersCommand(later(26)))).toBe(0)
    })
})

/** The names of the events published, in order. */
const told = (world: ReturnType<typeof studyWorld>) => world.published().map((event) => event.constructor.name)

describe('CloseAwayHandler', () => {
    // The 3 minutes are read on the app's clock.
    beforeEach(() => jest.useFakeTimers({ now: later(13) }))
    afterEach(() => jest.useRealTimers())

    it('closes the place of one still away since then, counting it, and hands a Host over (D-215)', async () => {
        const { world, closeAway } = setup()
        world.put(roomSession(), ['an', 'binh'])
        world.away.set('phien:an', later(10))
        await closeAway.execute(new CloseAwayCommand('phien:an', later(10)))
        expect(world.participants.get('phien')).toEqual(['binh'])
        expect(world.sessions.get('phien')).toMatchObject({ hostId: 'binh', version: 1 })
        expect(told(world)).toEqual(['StudyCountedEvent', 'FocusSessionChangedEvent'])
        expect(world.published()[1]).toMatchObject({ action: 'host', actorId: null })
    })

    it('leaves alone one back, or away again since', async () => {
        const { world, closeAway } = setup()
        world.put(roomSession(), ['an', 'binh'])
        await closeAway.execute(new CloseAwayCommand('phien:an', later(10)))
        world.away.set('phien:an', later(12))
        await closeAway.execute(new CloseAwayCommand('phien:an', later(10)))
        expect(world.participants.get('phien')).toEqual(['an', 'binh'])
        expect(world.published()).toEqual([])
    })

    it('leaves alone one away less than 3 minutes: a job run early by another app, closed once due', async () => {
        const { world, closeAway } = setup()
        world.put(roomSession(), ['an', 'binh'])
        world.away.set('phien:an', later(10.5))
        await closeAway.execute(new CloseAwayCommand('phien:an', later(10.5)))
        expect(world.participants.get('phien')).toEqual(['an', 'binh'])
        expect(world.repository.closeAway).not.toHaveBeenCalled()
    })
})

describe('EndEmptyRoomHandler', () => {
    it('ends the session (empty) of a room still empty since then, 5 minutes on (D-227)', async () => {
        const { world, endEmpty } = setup()
        world.put(roomSession({ emptySince: later(10) }), [])
        world.at(later(15))
        await endEmpty.execute(new EndEmptyRoomCommand('phien', later(10)))
        expect(world.sessions.get('phien')).toMatchObject({ status: 'ended', endedReason: 'empty' })
        expect(world.published().at(-1)).toMatchObject({ action: 'end', actorId: null })
    })

    it('leaves alone a room someone came into, or empty again since, or not yet 5 minutes', async () => {
        const { world, endEmpty } = setup()
        world.put(roomSession({ emptySince: null }), [])
        world.at(later(15))
        await endEmpty.execute(new EndEmptyRoomCommand('phien', later(10)))
        world.put(roomSession({ emptySince: later(12) }), [])
        await endEmpty.execute(new EndEmptyRoomCommand('phien', later(10)))
        world.at(later(14))
        await endEmpty.execute(new EndEmptyRoomCommand('phien', later(12)))
        expect(world.sessions.get('phien')).toMatchObject({ status: 'running' })
        expect(world.published()).toEqual([])
    })
})

describe('SweepStudyTimersHandler, presence', () => {
    it('ends the rooms empty 5 minutes and closes the places away 3 minutes whose job was lost', async () => {
        const { world, sweep } = setup()
        world.put(roomSession({ id: 'trong', emptySince: later(10) }), [])
        world.put(roomSession({ id: 'vang', channelId: 'phong-thi' }), ['chi'])
        world.away.set('vang:chi', later(12))
        world.inRoom.clear()
        world.at(later(15))
        expect(await sweep.execute(new SweepStudyTimersCommand(later(15)))).toBe(2)
        expect(world.sessions.get('trong')).toMatchObject({ status: 'ended', endedReason: 'empty' })
        expect(world.participants.get('vang')).toEqual([])
    })

    it('sets who is present against who is in the room: one gone is away, one there joins (D-225)', async () => {
        const { world, sweep } = setup()
        // Phong and Bình are in the room, An left it: their events were lost.
        world.put(roomSession(), ['an', 'binh'])
        world.inRoom.delete('an')
        await sweep.execute(new SweepStudyTimersCommand(later(5)))
        expect(world.participants.get('phien')).toEqual(['an', 'binh', 'phong'])
        expect([...world.away.keys()]).toEqual(['phien:an'])
        expect(world.published()).toEqual([
            new RoomPresenceChangedEvent('phien', { participationId: 'phien:an', since: NOW }, null),
            new ParticipationOpenedEvent(['phong'])
        ])
    })

    it('joins one in the room whose place is still open in another room, closing that one first (D-215)', async () => {
        const { world, sweep } = setup()
        world.put(roomSession({ id: 'cu', channelId: 'phong-thi', hostId: 'chi' }), ['chi', 'binh'])
        world.put(roomSession({ id: 'moi' }), ['an'])
        world.inRoom.set('chi', 'phong-thi')
        await sweep.execute(new SweepStudyTimersCommand(later(5)))
        // Bình is in Phòng học (their move's events lost): out of the old room, in the new.
        expect(world.participants.get('cu')).toEqual(['chi'])
        expect(world.participants.get('moi')).toEqual(['an', 'binh', 'phong'])
    })

    it('ends the session of a room that is no study room any more, or gone (D-227)', async () => {
        const { world, sweep } = setup()
        world.put(roomSession({ id: 'tat', channelId: 'tan-gau' }), [])
        world.put(roomSession({ id: 'xoa', channelId: 'da-xoa' }), [])
        await sweep.execute(new SweepStudyTimersCommand(later(5)))
        expect(world.sessions.get('tat')).toMatchObject({ status: 'ended', endedReason: 'study_disabled' })
        expect(world.sessions.get('xoa')).toMatchObject({ status: 'ended', endedReason: 'channel_deleted' })
    })

    it('goes on past a room whose check fails', async () => {
        const { world, sweep } = setup()
        world.put(roomSession({ id: 'hong' }), ['an', 'binh'])
        world.put(roomSession({ id: 'tot', channelId: 'phong-thi' }), [])
        ;(world.voiceRooms.peopleIn as jest.Mock).mockRejectedValueOnce(new Error('database down'))
        await sweep.execute(new SweepStudyTimersCommand(later(5)))
        expect(world.participants.get('tot')).toEqual(['chi'])
    })
})
