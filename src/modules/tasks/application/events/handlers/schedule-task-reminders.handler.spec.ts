import { TaskRecord, TaskRepositoryPort } from '../../../domain'
import { TaskJobsPort } from '../../ports'
import { TaskView } from '../../services/task-views'
import { TaskCreatedEvent } from '../task-created.event'
import { TaskDeletedEvent } from '../task-deleted.event'
import { TaskUpdatedEvent } from '../task-updated.event'
import { ScheduleTaskRemindersHandler } from './schedule-task-reminders.handler'

const HOUR = 3600_000
const NOW = new Date('2026-11-17T09:00:00Z')
const after = (hours: number) => new Date(NOW.getTime() + hours * HOUR)

const task = (status: TaskView['status'], dueAt: Date | null): TaskView =>
    ({ id: 't1', serverId: 'nd', channelId: 'viec-nhom', status, dueAt }) as TaskView

const updated = (before: { status: TaskView['status']; dueAt: Date | null }, now: TaskView) =>
    new TaskUpdatedEvent(now, { actorId: 'an', added: [], removed: [], before })

/** `stored`: the task as the database has it when the handler runs; null once deleted. */
function setup(stored: Partial<TaskRecord> | null = null) {
    jest.useFakeTimers({ now: NOW })
    const jobs = {
        remindLater: jest.fn().mockResolvedValue(undefined),
        cancelReminders: jest.fn().mockResolvedValue(undefined)
    }
    const tasks = { find: jest.fn(async () => stored) }
    const handler = new ScheduleTaskRemindersHandler(
        jobs as unknown as TaskJobsPort,
        tasks as unknown as TaskRepositoryPort
    )
    return { jobs, tasks, handler }
}

afterEach(() => jest.useRealTimers())

describe('ScheduleTaskRemindersHandler (REQ-TASK-04, ARCHITECTURE 7)', () => {
    it('sets the reminders still ahead of a task made with a due date: 3 hours out, only the 2-hour one (D-95)', async () => {
        const { jobs, handler } = setup()
        await handler.handle(new TaskCreatedEvent(task('todo', after(3))))
        expect(jobs.remindLater).toHaveBeenCalledWith('t1', after(3), [{ mark: '2h', at: after(1) }])
        expect(jobs.cancelReminders).not.toHaveBeenCalled()
    })

    it('sets none for a task made without a due date', async () => {
        const { jobs, handler } = setup()
        await handler.handle(new TaskCreatedEvent(task('todo', null)))
        expect(jobs.remindLater).not.toHaveBeenCalled()
    })

    it('drops the reminders of the old due date and sets those of the new one when it moves', async () => {
        const { jobs, handler } = setup()
        await handler.handle(updated({ status: 'todo', dueAt: after(30) }, task('todo', after(50))))
        expect(jobs.cancelReminders).toHaveBeenCalledWith('t1', after(30))
        expect(jobs.remindLater).toHaveBeenCalledWith('t1', after(50), [
            { mark: '24h', at: after(26) },
            { mark: '2h', at: after(48) }
        ])
    })

    it('drops them when the task is done or deleted, and sets them again when it is reopened', async () => {
        const { jobs, handler } = setup()
        await handler.handle(updated({ status: 'doing', dueAt: after(30) }, task('done', after(30))))
        await handler.handle(new TaskDeletedEvent('t1', 'viec-nhom', { status: 'todo', dueAt: after(30) }, ['an']))
        expect(jobs.cancelReminders.mock.calls).toEqual([
            ['t1', after(30)],
            ['t1', after(30)]
        ])
        expect(jobs.remindLater).not.toHaveBeenCalled()

        await handler.handle(updated({ status: 'done', dueAt: after(30) }, task('todo', after(30))))
        expect(jobs.remindLater).toHaveBeenCalledWith('t1', after(30), [
            { mark: '24h', at: after(6) },
            { mark: '2h', at: after(28) }
        ])
    })

    it('keeps the reminders of the due date the task has again, when two writes are heard out of order', async () => {
        // Moved from D to E, then back to D: the second write's event came first and found D's jobs still there.
        const { jobs, handler } = setup({ status: 'todo', dueAt: after(30) })
        await handler.handle(updated({ status: 'todo', dueAt: after(30) }, task('todo', after(50))))
        expect(jobs.cancelReminders).not.toHaveBeenCalled()
    })

    it('leaves them be when neither the due date nor being done changed', async () => {
        const { jobs, handler } = setup()
        await handler.handle(updated({ status: 'todo', dueAt: after(30) }, task('doing', after(30))))
        expect(jobs.cancelReminders).not.toHaveBeenCalled()
        expect(jobs.remindLater).not.toHaveBeenCalled()
    })

    it('throws when the queue fails, so the failure is seen (D-195)', async () => {
        const { jobs, handler } = setup()
        jobs.remindLater.mockRejectedValueOnce(new Error('redis down'))
        await expect(handler.handle(new TaskCreatedEvent(task('todo', after(30))))).rejects.toThrow('redis down')
    })
})
