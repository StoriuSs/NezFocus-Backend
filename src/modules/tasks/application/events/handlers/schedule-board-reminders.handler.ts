import { Inject, Logger } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { ServerChangedEvent } from '@/modules/servers'
import { futureMarks, TASK_REPOSITORY, TaskRepositoryPort } from '../../../domain'
import { TASK_JOBS, TaskJobsPort } from '../../ports'

/**
 * A Task Board turned on again (REQ-TASK-01): its tasks not done get their
 * reminders still ahead set again (ARCHITECTURE 7). Turning it off drops
 * none: each job finds the board off when it runs and does nothing, and one
 * still waiting is named as the one set again here, so it is not doubled. A
 * board that fails is logged and the others still get theirs; then the
 * failure is thrown (D-195).
 */
@EventsHandler(ServerChangedEvent)
export class ScheduleBoardRemindersHandler implements IEventHandler<ServerChangedEvent> {
    private readonly logger = new Logger(ScheduleBoardRemindersHandler.name)

    constructor(
        @Inject(TASK_REPOSITORY) private readonly tasks: TaskRepositoryPort,
        @Inject(TASK_JOBS) private readonly jobs: TaskJobsPort
    ) {}

    async handle({ boardsTurnedOn }: ServerChangedEvent): Promise<void> {
        let failure: unknown = null
        for (const channelId of boardsTurnedOn) {
            try {
                const now = new Date()
                for (const task of await this.tasks.listOpen({ channelId, search: null })) {
                    if (task.dueAt) await this.jobs.remindLater(task.id, task.dueAt, futureMarks(task.dueAt, now))
                }
            } catch (error) {
                this.logger.error(`The reminders of the board of channel ${channelId} not set: ${String(error)}`)
                failure ??= error
            }
        }
        if (failure) throw failure
    }
}
