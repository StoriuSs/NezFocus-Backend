import { SESSIONS, studyWorld } from '../../study-test-world.shared-spec'
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

    it('throws when the queue cannot be reached: the sweep runs that phase end (D-225)', async () => {
        const { jobs } = studyWorld()
        jobs.endPhaseAt.mockRejectedValueOnce(new Error('Redis down'))
        await expect(
            new SchedulePhaseEndHandler(jobs).handle(new FocusSessionChangedEvent(null, running, 'start', 'an', null))
        ).rejects.toThrow('Redis down')
    })
})
