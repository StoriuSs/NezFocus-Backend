import { Inject, Logger } from '@nestjs/common'
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { FOCUS_SESSION_REPOSITORY, FocusSessionRepositoryPort, phaseEndMove } from '../../../domain'
import { changeSession, ChangeSources } from '../../services/change-session'
import { STUDY_SETTINGS, StudySettings } from '../../study-settings'
import { EndFocusPhaseCommand, SweepStudyTimersCommand } from './session-timer.commands'

/** How many sessions one sweep takes: the next run takes the rest. */
const SWEEP_LIMIT = 100

/**
 * How early a phase end may run and still be made: a job is promoted by the
 * clock of the app that set it, which may be a little ahead of this one's.
 * Earlier than this, it is left alone; the sweep makes it once due.
 */
const EARLY_MS = 1000

/** The end of a phase as set for `version`, decided on the session once locked: true when it moved. */
async function endPhase(
    sources: ChangeSources,
    minuteMs: number,
    sessionId: string,
    version: number
): Promise<boolean> {
    const change = await changeSession(
        sources,
        sessionId,
        version,
        (session, at) =>
            session.phaseEndsAt && session.phaseEndsAt.getTime() > at.getTime() + EARLY_MS
                ? null
                : phaseEndMove(session, minuteMs),
        'phase_end',
        null
    )
    return change?.changed ?? false
}

/**
 * The end of a session's phase (ARCHITECTURE 5.1, D-222): the session is
 * read again under its lock, and one at another version by now (paused,
 * skipped, stopped, or this phase ended already) is left alone. Else the
 * next phase begins when this one was due (phaseEndMove), the stretch is
 * closed or opened there, everyone in it counted, and the room told; the
 * next job is set by FocusSessionChangedEvent. A job run more than EARLY_MS
 * before the phase was due does nothing: the sweep ends it once due.
 */
@CommandHandler(EndFocusPhaseCommand)
export class EndFocusPhaseHandler implements ICommandHandler<EndFocusPhaseCommand> {
    constructor(
        @Inject(FOCUS_SESSION_REPOSITORY) private readonly sessions: FocusSessionRepositoryPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort,
        @Inject(STUDY_SETTINGS) private readonly settings: StudySettings,
        private readonly events: EventBus
    ) {}

    async execute({ sessionId, version }: EndFocusPhaseCommand): Promise<void> {
        const { sessions, users, events } = this
        await endPhase({ sessions, users, events }, this.settings.minuteMs, sessionId, version)
    }
}

/**
 * The phase ends already due whose job was lost (Redis down when it was set,
 * the app stopped between the commit and setting it) or is late (D-225):
 * each run as its job would, at the version it has now, so a job that comes
 * meanwhile finds it moved and does nothing. A session caught up from far
 * behind moves a phase per run here, its next job set each time with no
 * delay. One that fails is logged and left for the next run: the others
 * are still made. Returns how many moved.
 */
@CommandHandler(SweepStudyTimersCommand)
export class SweepStudyTimersHandler implements ICommandHandler<SweepStudyTimersCommand> {
    private readonly logger = new Logger(SweepStudyTimersHandler.name)

    constructor(
        @Inject(FOCUS_SESSION_REPOSITORY) private readonly sessions: FocusSessionRepositoryPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort,
        @Inject(STUDY_SETTINGS) private readonly settings: StudySettings,
        private readonly events: EventBus
    ) {}

    async execute({ now }: SweepStudyTimersCommand): Promise<number> {
        const { sessions, users, events } = this
        let moved = 0
        for (const { id, version } of await sessions.overdue(now, SWEEP_LIMIT)) {
            try {
                if (await endPhase({ sessions, users, events }, this.settings.minuteMs, id, version)) moved++
            } catch (error) {
                this.logger.error(`The phase end of session ${id} failed: ${String(error)}`)
            }
        }
        return moved
    }
}

export const SESSION_TIMER_COMMAND_HANDLERS = [EndFocusPhaseHandler, SweepStudyTimersHandler]
