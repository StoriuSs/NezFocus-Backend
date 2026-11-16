import { Queue } from 'bullmq'
import { BullMqMessagePurge } from './bullmq-message-purge.adapter'
import { MESSAGING_JOBS } from './messaging-jobs'

describe('BullMqMessagePurge (D-181)', () => {
    it('queues one job per ban, its window as text, named by the ban so queueing it twice is one job', async () => {
        const queue = { add: jest.fn().mockResolvedValue(undefined) }
        const purge = new BullMqMessagePurge(queue as unknown as Queue)
        const window = { from: new Date('2026-11-09T09:00:00Z'), to: new Date('2026-11-16T09:00:00Z') }

        await purge.deleteRecentLater('ot', 'khanh', window)

        expect(queue.add).toHaveBeenCalledWith(
            MESSAGING_JOBS.DELETE_RECENT,
            { serverId: 'ot', userId: 'khanh', from: '2026-11-09T09:00:00.000Z', to: '2026-11-16T09:00:00.000Z' },
            { jobId: `delete-recent-ot-khanh-${window.to.getTime()}` }
        )
    })
})
