import { Inject } from '@nestjs/common'
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { CHANNEL_DIRECTORY, ChannelDirectoryPort, studyCycleProblem } from '@/modules/servers'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { VOICE_ROOMS, VoiceRoomsPort } from '@/modules/voice'
import {
    caughtUp,
    continueMove,
    ControlAction,
    cycleMove,
    FOCUS_SESSION_REPOSITORY,
    FocusSession,
    FocusSessionRepositoryPort,
    mayControl,
    pauseMove,
    resumeMove,
    SessionDecision,
    SessionRuleError,
    skipMove,
    stopMove,
    StudyForbiddenError,
    StudyRoomNotFoundError
} from '../../../domain'
import { changeSession, ChangeSources } from '../../services/change-session'
import { FocusSessionView, sessionView } from '../../services/session-views'
import { studyStanding } from '../../services/study-access'
import { STUDY_SETTINGS, StudySettings } from '../../study-settings'
import { ChangeFocusCycleCommand, ControlFocusSessionCommand } from './session-control.commands'

/** What deciding who may control a session reads, and changing it needs. */
interface ControlSources extends ChangeSources {
    channels: ChannelDirectoryPort
    checker: PermissionCheckerPort
    voiceRooms: VoiceRoomsPort
}

/**
 * The session `userId` may do `action` to (REQ-STUDY-03, D-222): a Solo of
 * theirs (another's is NOT_FOUND, as for no such session, D-229), or one of
 * a room they may see (else NOT_FOUND), not timed out (MEMBER_TIMED_OUT), as
 * its Host or with MANAGE_STUDY_ROOMS, or, with no Host, resuming it from
 * inside the room (D-119); else FORBIDDEN `not_host`. Decided on the
 * session as read, before its lock.
 */
async function controllable(
    sources: ControlSources,
    sessionId: string,
    userId: string,
    action: ControlAction | 'config'
): Promise<FocusSession> {
    const session = await sources.sessions.find(sessionId)
    if (session?.kind === 'solo' && session.userId === userId) return session
    if (!session || session.kind !== 'room' || !session.channelId) throw new StudyRoomNotFoundError(sessionId)
    const { managesStudyRooms } = await studyStanding(sources, session.channelId, userId, new Date())
    const inRoom =
        session.hostId === null && action === 'resume'
            ? (await sources.voiceRooms.roomOf(userId))?.channelId === session.channelId
            : false
    if (!mayControl(session, userId, action, { managesStudyRooms, inRoom })) throw new StudyForbiddenError('not_host')
    return session
}

/**
 * Does `action` for `userId` as `decide` says, on the session at the
 * version their client saw: changed since (someone else pressed first, the
 * phase moved), it is answered as it is, before any lock, and nothing is
 * told (D-225). The rights were decided at that same version, so a change
 * between this read and the lock (a new Host, M5 L3b) makes this one change
 * nothing too.
 */
async function control(
    sources: ControlSources,
    { userId, sessionId, version }: { userId: string; sessionId: string; version: number },
    action: ControlAction | 'config',
    decide: SessionDecision
): Promise<FocusSessionView> {
    const session = await controllable(sources, sessionId, userId, action)
    if (version !== session.version) return sessionView(session, new Date())
    const change = await changeSession(sources, sessionId, version, decide, action, userId)
    if (!change) throw new StudyRoomNotFoundError(sessionId)
    return sessionView(change.session, new Date())
}

/**
 * Pause, resume, skip or stop a session (REQ-STUDY-03), or Học tiếp of a
 * waiting Solo (REQ-STUDY-05), for whoever may (controllable). One already in that state, or changed since the version
 * the client saw (someone else pressed first, or the phase moved), is left
 * as it is: answered as it is now, 200, no event (D-225). A phase its job
 * missed ends first, when it was due (caughtUp). Stopping counts
 * everyone's seconds and closes their time in it; the room hears each one's
 * summary (D-49).
 */
@CommandHandler(ControlFocusSessionCommand)
export class ControlFocusSessionHandler implements ICommandHandler<ControlFocusSessionCommand> {
    constructor(
        @Inject(FOCUS_SESSION_REPOSITORY) private readonly sessions: FocusSessionRepositoryPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly checker: PermissionCheckerPort,
        @Inject(VOICE_ROOMS) private readonly voiceRooms: VoiceRoomsPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort,
        @Inject(STUDY_SETTINGS) private readonly settings: StudySettings,
        private readonly events: EventBus
    ) {}

    execute(command: ControlFocusSessionCommand): Promise<FocusSessionView> {
        const { sessions, channels, checker, voiceRooms, users, events } = this
        const { minuteMs } = this.settings
        const move = this.move(command.action)
        return control(
            { sessions, channels, checker, voiceRooms, users, events },
            command,
            command.action,
            (session, at) => caughtUp(session, at, minuteMs, move)
        )
    }

    private move(action: ControlAction): SessionDecision {
        const { minuteMs } = this.settings
        switch (action) {
            case 'pause':
                return pauseMove
            case 'resume':
                return resumeMove
            case 'skip':
                return (session, at) => skipMove(session, at, minuteMs)
            case 'stop':
                return (session, at) => stopMove(session, at, 'stopped')
            case 'continue':
                return (session, at) => continueMove(session, at, minuteMs)
        }
    }
}

/**
 * A new cycle for a session (REQ-STUDY-03, D-50), for whoever may control it
 * (controllable): only while paused, else VALIDATION_ERROR `not_paused`, and
 * one a study room could have (`study_cycle`); the phase begins
 * again at its new length and stays paused. Changed since the version the
 * client saw: left as it is (D-225).
 */
@CommandHandler(ChangeFocusCycleCommand)
export class ChangeFocusCycleHandler implements ICommandHandler<ChangeFocusCycleCommand> {
    constructor(
        @Inject(FOCUS_SESSION_REPOSITORY) private readonly sessions: FocusSessionRepositoryPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly checker: PermissionCheckerPort,
        @Inject(VOICE_ROOMS) private readonly voiceRooms: VoiceRoomsPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort,
        @Inject(STUDY_SETTINGS) private readonly settings: StudySettings,
        private readonly events: EventBus
    ) {}

    async execute(command: ChangeFocusCycleCommand): Promise<FocusSessionView> {
        const { sessions, channels, checker, voiceRooms, users, events } = this
        const { cycle } = command
        const problem = studyCycleProblem(cycle)
        if (problem) throw new SessionRuleError('study_cycle', problem)
        const { minuteMs } = this.settings
        const decide: SessionDecision = (session, at) => {
            const move = caughtUp(session, at, minuteMs, (current, now) => cycleMove(current, cycle, now, minuteMs))
            if (move?.clock.status === 'paused') return move
            // Ended: left as it is. Running (its missed phase ends too): only while paused.
            if (session.status === 'ended') return null
            throw new SessionRuleError('not_paused')
        }
        return control({ sessions, channels, checker, voiceRooms, users, events }, command, 'config', decide)
    }
}

export const SESSION_CONTROL_COMMAND_HANDLERS = [ControlFocusSessionHandler, ChangeFocusCycleHandler]
