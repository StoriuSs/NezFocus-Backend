import { Inject, Logger } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { AWAY_MINUTES, dueAt, EMPTY_MINUTES } from '../../../domain'
import { SESSION_JOBS, SessionJobsPort } from '../../ports'
import { STUDY_SETTINGS, StudySettings } from '../../study-settings'
import { RoomPresenceChangedEvent } from '../room-presence-changed.event'

/**
 * The jobs a change of who is present starts (ARCHITECTURE 5.2, 5.3): the
 * place of someone away closed AWAY_MINUTES on (D-215), the session of an
 * empty room ended EMPTY_MINUTES on (D-227), each in study minutes (D-221).
 * Nothing to drop when they come back: the job reads again and finds the
 * moment it was set for gone. Each is set even when the other could not
 * be; one that could not is logged and thrown, and the sweep runs it
 * (D-225).
 */
@EventsHandler(RoomPresenceChangedEvent)
export class SchedulePresenceTimersHandler implements IEventHandler<RoomPresenceChangedEvent> {
    private readonly logger = new Logger(SchedulePresenceTimersHandler.name)

    constructor(
        @Inject(SESSION_JOBS) private readonly jobs: SessionJobsPort,
        @Inject(STUDY_SETTINGS) private readonly settings: StudySettings
    ) {}

    async handle({ sessionId, away, emptySince }: RoomPresenceChangedEvent): Promise<void> {
        const { minuteMs } = this.settings
        const results = await Promise.allSettled([
            away && this.jobs.closeAwayAt(away.participationId, away.since, dueAt(away.since, AWAY_MINUTES, minuteMs)),
            emptySince && this.jobs.endEmptyAt(sessionId, emptySince, dueAt(emptySince, EMPTY_MINUTES, minuteMs))
        ])
        const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
        if (failed) {
            this.logger.error(`The presence timers of session ${sessionId} not set: ${String(failed.reason)}`)
            throw failed.reason
        }
    }
}
