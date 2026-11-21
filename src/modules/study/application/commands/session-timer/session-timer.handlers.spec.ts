import { FocusSessionChangedEvent } from '../../events/focus-session-changed.event'
import { MINUTE, NOW, roomSession, studyWorld } from '../../study-test-world.shared-spec'
import { EndFocusPhaseCommand, SweepStudyTimersCommand } from './session-timer.commands'
import { EndFocusPhaseHandler, SweepStudyTimersHandler } from './session-timer.handlers'

const later = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE)

function setup() {
    const world = studyWorld()
    const end = new EndFocusPhaseHandler(world.repository, world.users, world.settings, world.events)
    const sweep = new SweepStudyTimersHandler(world.repository, world.users, world.settings, world.events)
    return { world, end, sweep }
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
