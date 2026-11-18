import { Queue } from 'bullmq'
import { BullMqTaskJobs } from './bullmq-task-jobs.adapter'
import { TASKS_JOBS } from './tasks-jobs'

describe('BullMqTaskJobs (D-195, REQ-TASK-04)', () => {
    it('queues one job per leave, named by it so queueing it twice is one job', async () => {
        const queue = { add: jest.fn().mockResolvedValue(undefined) }
        const jobs = new BullMqTaskJobs(queue as unknown as Queue)
        const leftAt = new Date('2026-11-17T09:00:00Z')

        await jobs.unassignLeftMemberLater('nd', 'lan', leftAt)

        expect(queue.add).toHaveBeenCalledWith(
            TASKS_JOBS.UNASSIGN_LEFT_MEMBER,
            { serverId: 'nd', userId: 'lan' },
            { jobId: `unassign-left-member-nd-lan-${leftAt.getTime()}` }
        )
    })

    it('waits each reminder until its time, named by the task, the mark and the due date (ARCHITECTURE 7)', async () => {
        jest.useFakeTimers({ now: new Date('2026-11-17T09:00:00Z') })
        const queue = { addBulk: jest.fn().mockResolvedValue([]) }
        const jobs = new BullMqTaskJobs(queue as unknown as Queue)
        const dueAt = new Date('2026-11-18T16:59:00Z')

        await jobs.remindLater('t1', dueAt, [
            { mark: '24h', at: new Date('2026-11-17T16:59:00Z') },
            { mark: '2h', at: new Date('2026-11-18T14:59:00Z') }
        ])

        expect(queue.addBulk).toHaveBeenCalledWith([
            {
                name: TASKS_JOBS.SEND_REMINDER,
                data: { taskId: 't1', mark: '24h', dueAt: dueAt.toISOString() },
                opts: { jobId: `task-t1-24h-${dueAt.getTime()}`, delay: 8 * 3600_000 - 60_000 }
            },
            {
                name: TASKS_JOBS.SEND_REMINDER,
                data: { taskId: 't1', mark: '2h', dueAt: dueAt.toISOString() },
                opts: { jobId: `task-t1-2h-${dueAt.getTime()}`, delay: 30 * 3600_000 - 60_000 }
            }
        ])
        jest.useRealTimers()
    })

    it('queues nothing when no reminder is left ahead', async () => {
        const queue = { addBulk: jest.fn() }
        await new BullMqTaskJobs(queue as unknown as Queue).remindLater('t1', new Date(), [])
        expect(queue.addBulk).not.toHaveBeenCalled()
    })

    it('drops both reminders of a due date by their names', async () => {
        const queue = { remove: jest.fn().mockResolvedValue(1) }
        const dueAt = new Date('2026-11-18T16:59:00Z')

        await new BullMqTaskJobs(queue as unknown as Queue).cancelReminders('t1', dueAt)

        expect(queue.remove.mock.calls).toEqual([[`task-t1-24h-${dueAt.getTime()}`], [`task-t1-2h-${dueAt.getTime()}`]])
    })
})
