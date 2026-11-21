import { ControlAction, Cycle, FocusSession } from '../../../domain'
import { FocusSessionChangedEvent } from '../../events/focus-session-changed.event'
import { StudyCountedEvent } from '../../events/study-counted.event'
import { MINUTE, NOW, roomSession, studyWorld } from '../../study-test-world.shared-spec'
import { ChangeFocusCycleCommand, ControlFocusSessionCommand } from './session-control.commands'
import { ChangeFocusCycleHandler, ControlFocusSessionHandler } from './session-control.handlers'

const FIFTY: Cycle = { focusMinutes: 50, shortBreakMinutes: 10, longBreakMinutes: null, longBreakEvery: null }
const later = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE)

function setup(session: FocusSession = roomSession()) {
    const world = studyWorld()
    world.put(session)
    const deps = [
        world.repository,
        world.channels,
        world.checker,
        world.voiceRooms,
        world.users,
        world.settings,
        world.events
    ] as const
    const control = new ControlFocusSessionHandler(...deps)
    const config = new ChangeFocusCycleHandler(...deps)
    return {
        world,
        run: (userId: string, action: ControlAction, version = session.version, id = session.id) =>
            control.execute(new ControlFocusSessionCommand(userId, id, action, version)),
        cycle: (userId: string, cycle: Cycle, version = session.version) =>
            config.execute(new ChangeFocusCycleCommand(userId, session.id, cycle, version))
    }
}

const refusal = (done: Promise<unknown>) =>
    done.then(
        () => 'done',
        (error: { errorKey: string; details?: { reason?: string; rule?: string; problem?: string } }) =>
            [error.errorKey, error.details?.reason ?? error.details?.rule ?? error.details?.problem]
                .filter(Boolean)
                .join(' ')
    )

describe('ControlFocusSessionHandler', () => {
    it('pauses for the Host: everyone counted in their zone, then the change told, in that order', async () => {
        const { world, run } = setup()
        world.at(later(15))
        const view = await run('an', 'pause')
        expect(view).toMatchObject({
            status: 'paused',
            pausedRemainingMs: 10 * MINUTE,
            version: 1,
            stretchStartedAt: null
        })
        const published = world.published()
        expect(published.map((event) => event.constructor.name)).toEqual([
            'StudyCountedEvent',
            'StudyCountedEvent',
            'FocusSessionChangedEvent'
        ])
        expect((published[0] as StudyCountedEvent).count).toMatchObject({ userId: 'an', timeZone: 'Asia/Ho_Chi_Minh' })
        expect((published[1] as StudyCountedEvent).count).toMatchObject({ userId: 'binh', timeZone: 'UTC' })
        expect(published[2]).toMatchObject({ action: 'pause', actorId: 'an' })
    })

    it('resumes, skips and stops, each from the session as it is', async () => {
        const { world, run } = setup()
        world.at(later(15))
        await run('an', 'pause', 0)
        world.at(later(18))
        expect(await run('an', 'resume', 1)).toMatchObject({ status: 'running', phaseEndsAt: later(28) })
        expect(await run('an', 'skip', 2)).toMatchObject({ phase: 'short_break', phaseEndsAt: later(23) })
        const stopped = await run('an', 'stop', 3)
        expect(stopped).toMatchObject({ status: 'ended', endedReason: 'stopped' })
        const ended = world.published().at(-1) as FocusSessionChangedEvent
        expect(ended.summaries).toEqual([
            { userId: 'an', seconds: 60 },
            { userId: 'binh', seconds: 60 }
        ])
    })

    it('changes nothing and tells nothing for an old version, or a state the session is in already (D-225)', async () => {
        const { world, run } = setup()
        expect(await run('an', 'resume', 0)).toMatchObject({ status: 'running', version: 0 })
        expect(await run('an', 'pause', 7)).toMatchObject({ status: 'running', version: 0 })
        expect(world.published()).toEqual([])
    })

    it('lets the Host and MANAGE_STUDY_ROOMS control, in the room or not; others are refused', async () => {
        const { run } = setup()
        expect(await refusal(run('binh', 'pause'))).toBe('FORBIDDEN not_host')
        expect(await refusal(run('dung', 'pause'))).toBe('MEMBER_TIMED_OUT')
        expect(await refusal(run('khach', 'pause'))).toBe('NOT_FOUND')
        expect(await refusal(run('chi', 'pause'))).toBe('done')
    })

    it('lets anyone in the room resume a session with no Host, and nothing else (D-119)', async () => {
        const paused = roomSession({
            hostId: null,
            status: 'paused',
            phaseEndsAt: null,
            pausedRemainingMs: 10 * MINUTE,
            stretchStartedAt: null
        })
        const { world, run } = setup(paused)
        expect(await refusal(run('phong', 'skip'))).toBe('FORBIDDEN not_host')
        world.inRoom.delete('binh')
        expect(await refusal(run('binh', 'resume'))).toBe('FORBIDDEN not_host')
        expect(await refusal(run('phong', 'resume'))).toBe('done')
    })

    it('answers NOT_FOUND for no such session, and for a Solo (its person’s, M5 L4)', async () => {
        const solo = roomSession({
            id: 'solo',
            kind: 'solo',
            channelId: null,
            serverId: null,
            hostId: null,
            userId: 'an'
        })
        const { world, run } = setup()
        world.put(solo)
        expect(await refusal(run('an', 'pause', 0, 'khong-co'))).toBe('NOT_FOUND')
        expect(await refusal(run('an', 'pause', 0, 'solo'))).toBe('NOT_FOUND')
    })

    it('answers NOT_FOUND when the session is gone by the time it is changed', async () => {
        const { world, run } = setup()
        ;(world.repository.change as jest.Mock).mockResolvedValueOnce(null)
        expect(await refusal(run('an', 'pause'))).toBe('NOT_FOUND')
    })
})

describe('ChangeFocusCycleHandler', () => {
    const paused = () =>
        roomSession({ status: 'paused', phaseEndsAt: null, pausedRemainingMs: 10 * MINUTE, stretchStartedAt: null })

    it('begins the phase again at the new length, still paused (D-50), and tells it', async () => {
        const { world, cycle } = setup(paused())
        expect(await cycle('an', FIFTY)).toMatchObject({
            status: 'paused',
            focusMinutes: 50,
            pausedRemainingMs: 50 * MINUTE
        })
        expect(world.published()).toEqual([expect.objectContaining({ action: 'config', actorId: 'an' })])
    })

    it('refuses while running (not_paused) and half a long break (study_cycle); an ended one is left as it is', async () => {
        const { cycle } = setup()
        expect(await refusal(cycle('an', FIFTY))).toBe('VALIDATION_ERROR not_paused')
        expect(await refusal(cycle('an', { ...FIFTY, longBreakEvery: 4 }))).toBe('VALIDATION_ERROR study_cycle')

        const ended = roomSession({ status: 'ended', phaseEndsAt: null, endedAt: NOW, endedReason: 'stopped' })
        const { cycle: onEnded } = setup(ended)
        expect(await onEnded('an', FIFTY)).toMatchObject({ status: 'ended', version: 0 })
    })

    it('is refused to one who may not control it, and NOT_FOUND once the session is gone', async () => {
        const { world, cycle } = setup(paused())
        expect(await refusal(cycle('binh', FIFTY))).toBe('FORBIDDEN not_host')
        ;(world.repository.change as jest.Mock).mockResolvedValueOnce(null)
        expect(await refusal(cycle('an', FIFTY))).toBe('NOT_FOUND')
    })
})
