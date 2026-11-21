import { NOW, SESSIONS, soloSession, studyWorld } from '../../study-test-world.shared-spec'
import { FocusSessionChangedEvent } from '../focus-session-changed.event'
import { SchedulePhaseEndHandler } from './schedule-phase-end.handler'

const { running, paused } = SESSIONS

describe('SchedulePhaseEndHandler', () => {
    it('sets the job of the new version and drops the one of the version before', async () => {
        const { jobs } = studyWorld()
        const handler = new SchedulePhaseEndHandler(jobs)
        await handler.handle(new FocusSessionChangedEvent(null, running, 'start', 'an', null))
        expect(jobs.endPhaseAt).toHaveBeenLastCalledWith('phien', 0, running.phaseEndsAt)
        expect(jobs.dropPhaseEnd).not.toHaveBeenCalled()

        await handler.handle(new FocusSessionChangedEvent(running, paused, 'pause', 'an', null))
        expect(jobs.dropPhaseEnd).toHaveBeenCalledWith('phien', 0)
        expect(jobs.endPhaseAt).toHaveBeenCalledTimes(1)
    })

    it('keeps the job running now when it is the one that ended the phase', async () => {
        const { jobs } = studyWorld()
        const next = { ...running, version: 1, phase: 'short_break' as const }
        await new SchedulePhaseEndHandler(jobs).handle(
            new FocusSessionChangedEvent(running, next, 'phase_end', null, null)
        )
        expect(jobs.dropPhaseEnd).not.toHaveBeenCalled()
        expect(jobs.endPhaseAt).toHaveBeenCalledWith('phien', 1, next.phaseEndsAt)
    })

    it('sets the job of a waiting Solo at the end of its wait, and drops it once Học tiếp is pressed (REQ-STUDY-05)', async () => {
        const { jobs } = studyWorld()
        const handler = new SchedulePhaseEndHandler(jobs)
        const until = new Date(NOW.getTime() + 40 * 60_000)
        const waiting = soloSession({ status: 'waiting', phaseEndsAt: null, waitingUntil: until, version: 2 })
        await handler.handle(
            new FocusSessionChangedEvent(soloSession({ version: 1 }), waiting, 'phase_end', null, null)
        )
        expect(jobs.endPhaseAt).toHaveBeenLastCalledWith('solo', 2, until)

        const focus = soloSession({ version: 3 })
        await handler.handle(new FocusSessionChangedEvent(waiting, focus, 'continue', 'an', null))
        expect(jobs.dropPhaseEnd).toHaveBeenCalledWith('solo', 2)
        expect(jobs.endPhaseAt).toHaveBeenLastCalledWith('solo', 3, focus.phaseEndsAt)
    })

    it('throws when the queue cannot be reached: the sweep runs that phase end (D-225)', async () => {
        const { jobs } = studyWorld()
        jobs.endPhaseAt.mockRejectedValueOnce(new Error('Redis down'))
        await expect(
            new SchedulePhaseEndHandler(jobs).handle(new FocusSessionChangedEvent(null, running, 'start', 'an', null))
        ).rejects.toThrow('Redis down')
    })
})
