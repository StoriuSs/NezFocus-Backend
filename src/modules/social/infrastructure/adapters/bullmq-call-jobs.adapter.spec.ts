import { Queue } from 'bullmq'
import { BullMqCallJobs } from './bullmq-call-jobs.adapter'
import { SOCIAL_JOBS } from './social-jobs'

describe('BullMqCallJobs (ARCHITECTURE 6, D-242)', () => {
    afterEach(() => jest.useRealTimers())

    it('waits a ring-out until its time, named by the call and the version it was set for', async () => {
        jest.useFakeTimers({ now: new Date('2026-11-24T21:47:00Z') })
        const queue = { add: jest.fn().mockResolvedValue(undefined) }
        await new BullMqCallJobs(queue as unknown as Queue).ringOutAt('goi', 0, new Date('2026-11-24T21:47:45Z'))
        expect(queue.add).toHaveBeenCalledWith(
            SOCIAL_JOBS.RING_OUT,
            { callId: 'goi', version: 0 },
            { jobId: 'call-goi-ring-0', delay: 45_000 }
        )
    })

    it('runs a ring-out already due at once', async () => {
        jest.useFakeTimers({ now: new Date('2026-11-24T21:48:00Z') })
        const queue = { add: jest.fn().mockResolvedValue(undefined) }
        await new BullMqCallJobs(queue as unknown as Queue).ringOutAt('goi', 0, new Date('2026-11-24T21:47:45Z'))
        expect(queue.add.mock.calls[0][2]).toEqual({ jobId: 'call-goi-ring-0', delay: 0 })
    })

    it('drops the ring-out of a version gone by', async () => {
        const queue = { remove: jest.fn().mockResolvedValue(1) }
        await new BullMqCallJobs(queue as unknown as Queue).dropRingOut('goi', 0)
        expect(queue.remove).toHaveBeenCalledWith('call-goi-ring-0')
    })

    it('waits a media check until the deadline, named by the call and its version: call-<id>-media-<version>', async () => {
        jest.useFakeTimers({ now: new Date('2026-11-24T21:47:00Z') })
        const queue = { add: jest.fn().mockResolvedValue(undefined) }
        await new BullMqCallJobs(queue as unknown as Queue).checkMediaAt('goi', 3, new Date('2026-11-24T21:47:15Z'))
        expect(queue.add).toHaveBeenCalledWith(
            SOCIAL_JOBS.MEDIA_CHECK,
            { callId: 'goi', version: 3 },
            { jobId: 'call-goi-media-3', delay: 15_000 }
        )
    })

    it('drops the media check of a version gone by', async () => {
        const queue = { remove: jest.fn().mockResolvedValue(1) }
        await new BullMqCallJobs(queue as unknown as Queue).dropMediaCheck('goi', 2)
        expect(queue.remove).toHaveBeenCalledWith('call-goi-media-2')
    })
})
