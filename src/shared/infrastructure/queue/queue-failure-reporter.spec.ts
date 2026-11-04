import { EventEmitter } from 'events'
import { DiscoveryService } from '@nestjs/core'
import { WorkerHost } from '@nestjs/bullmq'
import type { Job } from 'bullmq'
import { reportError } from '@/shared/infrastructure/monitoring/error-reporting'
import { QueueFailureReporter } from './queue-failure-reporter'

jest.mock('@/shared/infrastructure/monitoring/error-reporting', () => ({ reportError: jest.fn() }))

class FakeWorker extends EventEmitter {
    constructor(readonly name: string) {
        super()
    }
}

class FakeConsumer extends WorkerHost {
    constructor(private readonly fakeWorker: FakeWorker) {
        super()
    }
    override get worker() {
        return this.fakeWorker as never
    }
    async process() {}
}

const job = (fields: Partial<Job>) => ({ id: '42', name: 'sweep-deleted-accounts', attemptsMade: 1, ...fields }) as Job

function setUp() {
    const worker = new FakeWorker('maintenance')
    const discovery = {
        getProviders: () => [{ instance: new FakeConsumer(worker) }]
    } as unknown as DiscoveryService
    const logger = { error: jest.fn() }
    const reporter = new QueueFailureReporter(discovery)
    ;(reporter as unknown as { logger: object }).logger = logger
    reporter.onApplicationBootstrap()
    return { worker, logger }
}

describe('QueueFailureReporter', () => {
    it('reports a job that failed for good without its data, which can hold personal details', () => {
        const { worker, logger } = setUp()
        const error = new Error('Postgres is down')
        worker.emit(
            'failed',
            job({ attemptsMade: 10, finishedOn: Date.now(), data: { email: 'alice@example.com' } }),
            error
        )

        expect(reportError).toHaveBeenCalledWith(error, expect.objectContaining({ extra: { jobId: '42' } }))
        expect(logger.error).toHaveBeenCalled()
        expect(JSON.stringify([jest.mocked(reportError).mock.calls, logger.error.mock.calls])).not.toContain('alice')
    })
})
