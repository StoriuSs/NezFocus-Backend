import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger, OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { CommandBus } from '@nestjs/cqrs'
import { Job, Queue } from 'bullmq'
import { QUEUES } from '@/shared/infrastructure/queue/queues'
import { MAINTENANCE_TASKS } from './maintenance-tasks'

/**
 * Runs MAINTENANCE_TASKS on their schedules.
 *
 * Each schedule lives in Redis as a BullMQ job scheduler, so however many app
 * instances run, each tick is one job handled by one of them — unlike an
 * in-process cron, which would fire on every instance. One queue for them all,
 * of its own: a backlog of emails or file deletions never delays them.
 */
@Processor(QUEUES.MAINTENANCE)
export class MaintenanceConsumer extends WorkerHost implements OnApplicationBootstrap {
    private readonly logger = new Logger(MaintenanceConsumer.name)

    constructor(
        private readonly commandBus: CommandBus,
        private readonly config: ConfigService,
        @InjectQueue(QUEUES.MAINTENANCE) private readonly queue: Queue
    ) {
        super()
    }

    async onApplicationBootstrap(): Promise<void> {
        // Upsert: every instance calls this at boot, and each stays one schedule.
        for (const task of MAINTENANCE_TASKS) {
            await this.queue.upsertJobScheduler(task.id, { every: task.everyMs }, { name: task.id })
        }
        // A task taken off the list, or renamed, would otherwise keep adding
        // jobs nobody runs: its schedule is in Redis, not in the code.
        const listed = new Set(MAINTENANCE_TASKS.map((task) => task.id))
        for (const scheduler of await this.queue.getJobSchedulers()) {
            if (!listed.has(scheduler.key)) await this.queue.removeJobScheduler(scheduler.key)
        }
    }

    async process(job: Job): Promise<void> {
        const task = MAINTENANCE_TASKS.find(({ id }) => id === job.name)
        if (!task) {
            this.logger.warn(`Unknown maintenance job "${job.name}" (${job.id}), ignored`)
            return
        }
        const result: unknown = await this.commandBus.execute(task.command(new Date(), this.config))
        this.logger.debug(`${task.id} ${job.id}: ${JSON.stringify(result)}`)
    }
}
