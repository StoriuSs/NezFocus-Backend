import { Inject, Logger } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { FocusSessionChangedEvent } from '../focus-session-changed.event'
import { SESSION_JOBS, SessionJobsPort } from '../../ports'

/**
 * The job that ends a session's phase, after each change (ARCHITECTURE
 * 5.1): set for the new version when the session runs, at when its phase
 * ends (no delay if that has passed: it catches up); the one set for the
 * version before dropped, unless that is the job running now. A job left
 * behind does no harm, as it reads the session again; one that could not be
 * set is logged and thrown, and the sweep runs that phase end (D-225).
 */
@EventsHandler(FocusSessionChangedEvent)
export class SchedulePhaseEndHandler implements IEventHandler<FocusSessionChangedEvent> {
    private readonly logger = new Logger(SchedulePhaseEndHandler.name)

    constructor(@Inject(SESSION_JOBS) private readonly jobs: SessionJobsPort) {}

    async handle({ before, after, action }: FocusSessionChangedEvent): Promise<void> {
        try {
            if (before?.status === 'running' && action !== 'phase_end') {
                await this.jobs.dropPhaseEnd(before.id, before.version)
            }
            if (after.status === 'running') await this.jobs.endPhaseAt(after.id, after.version, after.phaseEndsAt!)
        } catch (error) {
            this.logger.error(`The phase end of session ${after.id} not set: ${String(error)}`)
            throw error
        }
    }
}
