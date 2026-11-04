import { Injectable, Logger, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common'
import { DiscoveryService } from '@nestjs/core'
import { throttledLog } from '@/shared/utils/log-throttle.util'
import { findQueueInstances, findWorkers } from './registered-queues'

/** One message per queue or worker per minute while its errors repeat. */
export const QUEUE_ERROR_LOG_INTERVAL_MS = 60_000

type ErrorSource = { name: string; on(event: 'error', listener: (error: Error) => void): unknown }

/**
 * Sends BullMQ's errors to the app's logger.
 *
 * Every Queue and Worker re-emits its Redis connection's errors as an 'error'
 * event. With nobody listening, BullMQ falls back to console.error(error):
 * while Redis is down, a dozen lines of stack trace per queue every few
 * seconds, written around the logger. They are not JSON and carry no level,
 * so Loki stored each line as its own entry, and none of them counted as an
 * error in the dashboards or the AppErrorLogs alert.
 */
@Injectable()
export class QueueErrorLogger implements OnModuleInit, OnApplicationBootstrap {
    private readonly logger = new Logger(QueueErrorLogger.name)

    constructor(private readonly discovery: DiscoveryService) {}

    /** Queues exist once their modules are created, so listen before anything connects. */
    onModuleInit() {
        for (const queue of findQueueInstances(this.discovery)) this.listen('Queue', queue)
    }

    /** @nestjs/bullmq creates workers in its own onModuleInit: only afterwards are they there. */
    onApplicationBootstrap() {
        for (const worker of findWorkers(this.discovery)) this.listen('Worker', worker)
    }

    private listen(kind: 'Queue' | 'Worker', source: ErrorSource) {
        const log = throttledLog((message) => this.logger.error(message), QUEUE_ERROR_LOG_INTERVAL_MS)
        source.on('error', (error: Error) =>
            log(`${kind} ${source.name}: ${error.message || error.name || String(error)}`)
        )
    }
}
