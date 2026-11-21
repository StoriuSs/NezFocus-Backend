import { MINUTE, NOW, studyWorld } from '../../study-test-world.shared-spec'
import { RoomPresenceChangedEvent } from '../room-presence-changed.event'
import { SchedulePresenceTimersHandler } from './schedule-presence-timers.handler'

const later = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE)

describe('SchedulePresenceTimersHandler', () => {
    it('closes a place away 3 minutes on, and ends an empty room 5 minutes on, in study minutes (D-215, D-227)', async () => {
        const { jobs, settings } = studyWorld()
        const handler = new SchedulePresenceTimersHandler(jobs, settings)
        await handler.handle(new RoomPresenceChangedEvent('phien', { participationId: 'p', since: NOW }, NOW))
        expect(jobs.closeAwayAt).toHaveBeenCalledWith('p', NOW, later(3))
        expect(jobs.endEmptyAt).toHaveBeenCalledWith('phien', NOW, later(5))

        await new SchedulePresenceTimersHandler(jobs, { minuteMs: 1000 }).handle(
            new RoomPresenceChangedEvent('phien', null, NOW)
        )
        expect(jobs.endEmptyAt).toHaveBeenLastCalledWith('phien', NOW, new Date(NOW.getTime() + 5000))
        expect(jobs.closeAwayAt).toHaveBeenCalledTimes(1)
    })

    it('throws when the queue cannot be reached: the sweep runs it (D-225)', async () => {
        const { jobs, settings } = studyWorld()
        jobs.closeAwayAt.mockRejectedValueOnce(new Error('Redis down'))
        await expect(
            new SchedulePresenceTimersHandler(jobs, settings).handle(
                new RoomPresenceChangedEvent('phien', { participationId: 'p', since: NOW }, null)
            )
        ).rejects.toThrow('Redis down')
    })
})
