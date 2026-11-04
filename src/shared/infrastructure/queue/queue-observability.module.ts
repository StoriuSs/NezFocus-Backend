import { Module } from '@nestjs/common'
import { DiscoveryModule } from '@nestjs/core'
import { QueueErrorLogger } from './queue-error-logger'
import { QueueFailureReporter } from './queue-failure-reporter'
import { QueueMetricsCollector } from './queue-metrics'

/**
 * Watches every BullMQ queue registered anywhere in the app: job counts as the
 * `bullmq_jobs` metric, queue and worker errors into the app's logger, and
 * jobs that failed for good into the logger and error tracking.
 * Imported once, by AppModule; feature modules keep registering their queues
 * as before.
 */
@Module({
    imports: [DiscoveryModule],
    providers: [QueueMetricsCollector, QueueErrorLogger, QueueFailureReporter]
})
export class QueueObservabilityModule {}
