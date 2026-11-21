import { Queue } from 'bullmq'
import { BullMqSessionJobs } from './bullmq-session-jobs.adapter'
import { STUDY_JOBS } from './study-jobs'

describe('BullMqSessionJobs (ARCHITECTURE 5.1, D-222)', () => {
    afterEach(() => jest.useRealTimers())

    it('waits a phase end until its time, named by the session and the version it was set for', async () => {
        jest.useFakeTimers({ now: new Date('2026-11-21T20:00:00Z') })
        const queue = { add: jest.fn().mockResolvedValue(undefined) }
        await new BullMqSessionJobs(queue as unknown as Queue).endPhaseAt('phien', 3, new Date('2026-11-21T20:25:00Z'))
        expect(queue.add).toHaveBeenCalledWith(
            STUDY_JOBS.END_PHASE,
            { sessionId: 'phien', version: 3 },
            { jobId: 'focus-phien-3', delay: 25 * 60_000 }
        )
    })

    it('runs a phase end already due at once: a session catching up (D-225)', async () => {
        jest.useFakeTimers({ now: new Date('2026-11-21T20:30:00Z') })
        const queue = { add: jest.fn().mockResolvedValue(undefined) }
        await new BullMqSessionJobs(queue as unknown as Queue).endPhaseAt('phien', 4, new Date('2026-11-21T20:25:00Z'))
        expect(queue.add.mock.calls[0][2]).toEqual({ jobId: 'focus-phien-4', delay: 0 })
    })

    it('drops the job of a version gone by', async () => {
        const queue = { remove: jest.fn().mockResolvedValue(1) }
        await new BullMqSessionJobs(queue as unknown as Queue).dropPhaseEnd('phien', 3)
        expect(queue.remove).toHaveBeenCalledWith('focus-phien-3')
    })
})
