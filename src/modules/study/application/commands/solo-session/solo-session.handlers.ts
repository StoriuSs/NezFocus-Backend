import { Inject } from '@nestjs/common'
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import { studyCycleProblem } from '@/modules/servers'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import {
    caughtUp,
    FIRST_SOLO_CYCLE,
    FOCUS_SESSION_REPOSITORY,
    FocusSessionRepositoryPort,
    SessionRuleError,
    stopMove
} from '../../../domain'
import { FocusSessionChangedEvent } from '../../events/focus-session-changed.event'
import { ParticipationOpenedEvent } from '../../events/participation-opened.event'
import { askedCycle } from '../../services/asked-cycle'
import { changeSession } from '../../services/change-session'
import { FocusSessionView, sessionView } from '../../services/session-views'
import { STUDY_SETTINGS, StudySettings } from '../../study-settings'
import { EndSignedOutSoloCommand, StartSoloSessionCommand } from './solo-session.commands'

/**
 * Starts a Solo (REQ-STUDY-05): its first focus phase runs from now. The
 * cycle sent, one a study room could have (else VALIDATION_ERROR
 * `study_cycle`); none sent, the cycle of their last Solo, or 25/5 for a
 * first one (D-103). Anyone may, in a voice room with no session too; one
 * still taking part in a session (a Room Session, away from it included, or
 * another Solo) is FOCUS_SESSION_ACTIVE, decided by the database.
 */
@CommandHandler(StartSoloSessionCommand)
export class StartSoloSessionHandler implements ICommandHandler<StartSoloSessionCommand> {
    constructor(
        @Inject(FOCUS_SESSION_REPOSITORY) private readonly sessions: FocusSessionRepositoryPort,
        @Inject(STUDY_SETTINGS) private readonly settings: StudySettings,
        private readonly events: EventBus
    ) {}

    async execute({ userId, cycle }: StartSoloSessionCommand): Promise<FocusSessionView> {
        const asked = askedCycle(cycle)
        const problem = asked && studyCycleProblem(asked)
        if (problem) throw new SessionRuleError('study_cycle', problem)
        const session = await this.sessions.startSolo({
            userId,
            cycle: asked ?? (await this.sessions.lastSoloCycle(userId)) ?? FIRST_SOLO_CYCLE,
            minuteMs: this.settings.minuteMs
        })
        this.events.publish(new FocusSessionChangedEvent(null, session, 'start', userId, null))
        // Where the Solo is counted from: their minutes today grow from now (D-232).
        this.events.publish(new ParticipationOpenedEvent([userId]))
        return sessionView(session, new Date())
    }
}

/**
 * Ends the Solo of one who pressed Đăng xuất (D-229, spec 10), as
 * `signed_out`: counted up to now and closed, the seconds kept. A timer its
 * job missed is made first (caughtUp): a wait already over ended it as
 * expired. Nothing when they have none.
 */
@CommandHandler(EndSignedOutSoloCommand)
export class EndSignedOutSoloHandler implements ICommandHandler<EndSignedOutSoloCommand> {
    constructor(
        @Inject(FOCUS_SESSION_REPOSITORY) private readonly sessions: FocusSessionRepositoryPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort,
        @Inject(STUDY_SETTINGS) private readonly settings: StudySettings,
        private readonly events: EventBus
    ) {}

    async execute({ userId }: EndSignedOutSoloCommand): Promise<void> {
        const { sessions, users, events } = this
        const solo = await sessions.openSolo(userId)
        if (!solo) return
        const { minuteMs } = this.settings
        await changeSession(
            { sessions, users, events },
            solo.id,
            null,
            (session, at) => caughtUp(session, at, minuteMs, (current, now) => stopMove(current, now, 'signed_out')),
            'end',
            null
        )
    }
}

export const SOLO_SESSION_COMMAND_HANDLERS = [StartSoloSessionHandler, EndSignedOutSoloHandler]
