import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { DiscoveryService } from '@nestjs/core'
import { Gauge, register } from 'prom-client'
import { findQueueInstances } from './registered-queues'

export const QUEUE_JOBS_METRIC = 'bullmq_jobs'

/** A scrape gives up on Redis after this long, and reports no queue data. */
export const QUEUE_METRICS_TIMEOUT_MS = 2000

/**
 * `bullmq_jobs{queue, state}`: how many jobs each queue holds in each state
 * (waiting, active, delayed, failed, ...), read from Redis when Prometheus
 * scrapes. A growing `waiting` means workers can't keep up; `failed` counts
 * jobs that used up their retries and are kept for inspection.
 *
 * Every app instance reports the same queues: aggregate with max, not sum.
 */
@Injectable()
export class QueueMetricsCollector implements OnModuleInit {
    private readonly logger = new Logger(QueueMetricsCollector.name)

    constructor(private readonly discovery: DiscoveryService) {}

    onModuleInit() {
        // One instance per queue name: two modules registering the same queue
        // are two instances with the same jobs.
        const byName = new Map(findQueueInstances(this.discovery).map((queue) => [queue.name, queue]))
        const queues = [...byName.values()]
        if (queues.length === 0) return

        // A test that builds the app twice would register the metric twice.
        register.removeSingleMetric(QUEUE_JOBS_METRIC)
        const logger = this.logger
        // Logged when a queue starts and stops failing, not on every scrape:
        // during a Redis outage that would be a line per queue every 5 seconds.
        const failing = new Set<string>()
        new Gauge({
            name: QUEUE_JOBS_METRIC,
            help: 'Jobs in each BullMQ queue, by state',
            labelNames: ['queue', 'state'],
            async collect() {
                // Old values must not survive a failed read: they would look current.
                this.reset()
                await Promise.all(
                    queues.map(async (queue) => {
                        try {
                            const counts = await withTimeout(queue.getJobCounts(), QUEUE_METRICS_TIMEOUT_MS)
                            for (const [state, count] of Object.entries(counts)) {
                                this.set({ queue: queue.name, state }, count)
                            }
                            if (failing.delete(queue.name)) logger.log(`Job counts of ${queue.name} can be read again`)
                        } catch (error) {
                            if (failing.has(queue.name)) return
                            failing.add(queue.name)
                            logger.warn(`Could not read job counts of ${queue.name}: ${(error as Error).message}`)
                        }
                    })
                )
            }
        })
    }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
    })
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
