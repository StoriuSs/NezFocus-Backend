import { Inject } from '@nestjs/common'
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { CHANNEL_DIRECTORY, ChannelDirectoryPort, studyCycleProblem } from '@/modules/servers'
import { VOICE_ROOMS, VoiceRoomsPort } from '@/modules/voice'
import {
    Cycle,
    FOCUS_SESSION_REPOSITORY,
    FocusSessionRepositoryPort,
    mayStart,
    SessionRuleError,
    StudyForbiddenError
} from '../../../domain'
import { FocusSessionChangedEvent } from '../../events/focus-session-changed.event'
import { FocusSessionView, sessionView } from '../../services/session-views'
import { studyStanding } from '../../services/study-access'
import { STUDY_SETTINGS, StudySettings } from '../../study-settings'
import { StartRoomSessionCommand } from './room-session.commands'

/**
 * The cycle a start asks for: none when no part of one is sent (the room's
 * default). A part left out is caught by studyCycleProblem as out of range:
 * focus and short break go together, the long break both halves or neither.
 */
function askedCycle(cycle: Partial<Cycle>): Cycle | null {
    if (Object.values(cycle).every((part) => part == null)) return null
    return {
        focusMinutes: cycle.focusMinutes as number,
        shortBreakMinutes: cycle.shortBreakMinutes as number,
        longBreakMinutes: cycle.longBreakMinutes ?? null,
        longBreakEvery: cycle.longBreakEvery ?? null
    }
}

/**
 * Starts a Room Session (REQ-STUDY-02, D-222): in a voice room one may see
 * (else NOT_FOUND), not timed out (MEMBER_TIMED_OUT), that is a study room,
 * whose setting lets them start (anyone, or MANAGE_STUDY_ROOMS), from inside
 * it (each else FORBIDDEN with its reason). They are its Host; everyone in
 * the room then takes part from now. A room with a session not yet ended:
 * FOCUS_SESSION_ACTIVE. The cycle sent, or the room's default; one a study
 * room could not have is VALIDATION_ERROR `study_cycle`.
 */
@CommandHandler(StartRoomSessionCommand)
export class StartRoomSessionHandler implements ICommandHandler<StartRoomSessionCommand> {
    constructor(
        @Inject(FOCUS_SESSION_REPOSITORY) private readonly sessions: FocusSessionRepositoryPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly checker: PermissionCheckerPort,
        @Inject(VOICE_ROOMS) private readonly voiceRooms: VoiceRoomsPort,
        @Inject(STUDY_SETTINGS) private readonly settings: StudySettings,
        private readonly events: EventBus
    ) {}

    async execute({ userId, channelId, cycle }: StartRoomSessionCommand): Promise<FocusSessionView> {
        const asked = askedCycle(cycle)
        const problem = asked && studyCycleProblem(asked)
        if (problem) throw new SessionRuleError('study_cycle', problem)
        const { room, managesStudyRooms } = await studyStanding(
            { channels: this.channels, checker: this.checker },
            channelId,
            userId,
            new Date()
        )
        if (!room.isStudyRoom) throw new StudyForbiddenError('not_study_room')
        if (!mayStart(room.studyStarter, managesStudyRooms)) throw new StudyForbiddenError('cannot_start')
        if ((await this.voiceRooms.roomOf(userId))?.channelId !== channelId)
            throw new StudyForbiddenError('not_in_room')

        const { session } = await this.sessions.startInRoom(
            {
                serverId: room.serverId,
                channelId,
                hostId: userId,
                cycle: asked ?? {
                    focusMinutes: room.focusMinutes,
                    shortBreakMinutes: room.shortBreakMinutes,
                    longBreakMinutes: room.longBreakMinutes,
                    longBreakEvery: room.longBreakEvery
                },
                minuteMs: this.settings.minuteMs
            },
            async () => (await this.voiceRooms.peopleIn(channelId)).map((person) => person.userId)
        )
        this.events.publish(new FocusSessionChangedEvent(null, session, 'start', userId, null))
        return sessionView(session, new Date())
    }
}

export const ROOM_SESSION_COMMAND_HANDLERS = [StartRoomSessionHandler]
