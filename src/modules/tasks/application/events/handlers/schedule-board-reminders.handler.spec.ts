import { ServerChangedEvent } from '@/modules/servers'
import { TaskJobsPort } from '../../ports'
import { NOW, taskWorld } from '../../task-test-world.shared-spec'
import { ScheduleBoardRemindersHandler } from './schedule-board-reminders.handler'

const HOUR = 3600_000
const after = (hours: number) => new Date(NOW.getTime() + hours * HOUR)

describe('ScheduleBoardRemindersHandler (REQ-TASK-01, 04)', () => {
    function setup() {
        const world = taskWorld()
        const jobs = { remindLater: jest.fn().mockResolvedValue(undefined) }
        const handler = new ScheduleBoardRemindersHandler(world.repository, jobs as unknown as TaskJobsPort)
        return { ...world, jobs, handler }
    }

    it('sets again the reminders still ahead of the tasks not done of a board turned on', async () => {
        const { seed, jobs, handler } = setup()
        const soon = seed({ dueAt: after(3) })
        seed({ dueAt: null })
        seed({ status: 'done', dueAt: after(30), completedAt: NOW })
        seed({ channelId: 'bi-mat', dueAt: after(30) })

        await handler.handle(
            new ServerChangedEvent('nd', [{ topic: 'channel', action: 'updated' }], false, ['viec-nhom'])
        )

        expect(jobs.remindLater).toHaveBeenCalledTimes(1)
        expect(jobs.remindLater).toHaveBeenCalledWith(soon, after(3), [{ mark: '2h', at: expect.any(Date) as Date }])
    })

    it('still sets the reminders of the other boards when one fails, then throws (D-195)', async () => {
        const { seed, jobs, handler, repository } = setup()
        seed({ channelId: 'bi-mat', dueAt: after(30) })
        ;(repository.listOpen as jest.Mock).mockRejectedValueOnce(new Error('connection lost'))

        await expect(
            handler.handle(
                new ServerChangedEvent('nd', [{ topic: 'channel', action: 'updated' }], false, ['viec-nhom', 'bi-mat'])
            )
        ).rejects.toThrow('connection lost')
        expect(jobs.remindLater).toHaveBeenCalledTimes(1)
    })

    it('does nothing for a change that turned no board on', async () => {
        const { seed, jobs, handler } = setup()
        seed({ dueAt: after(30) })
        await handler.handle(new ServerChangedEvent('nd', [{ topic: 'channel', action: 'updated' }], false))
        expect(jobs.remindLater).not.toHaveBeenCalled()
    })
})
