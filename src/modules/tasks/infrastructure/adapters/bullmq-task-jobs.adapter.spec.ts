import { Queue } from 'bullmq'
import { BullMqTaskJobs } from './bullmq-task-jobs.adapter'
import { TASKS_JOBS } from './tasks-jobs'

describe('BullMqTaskJobs (D-195)', () => {
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
})
