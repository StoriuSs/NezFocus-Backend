import { Inject, Logger } from '@nestjs/common'
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { CHANNEL_DIRECTORY, ChannelDirectoryPort, studyCycleProblem } from '@/modules/servers'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { VOICE_ROOMS, VoiceRoomsPort } from '@/modules/voice'
import {
    FOCUS_SESSION_REPOSITORY,
    FocusSessionRepositoryPort,
    mayStart,
    SessionRuleError,
    StudyForbiddenError
} from '../../../domain'
import { FocusSessionChangedEvent } from '../../events/focus-session-changed.event'
import { ParticipationOpenedEvent } from '../../events/participation-opened.event'
import { askedCycle } from '../../services/asked-cycle'
import { tellChange, zoneOf } from '../../services/change-session'
import { endIfRoomGone } from '../../services/end-gone-rooms'
import { FocusSessionView, sessionView } from '../../services/session-views'
import { studyStanding } from '../../services/study-access'
import { STUDY_SETTINGS, StudySettings } from '../../study-settings'
import { EndGoneRoomSessionsCommand, StartRoomSessionCommand } from './room-session.commands'

/**
 * Starts a Room Session (REQ-STUDY-02, D-222): in a voice room one may see
 * (else NOT_FOUND), not timed out (MEMBER_TIMED_OUT), that is a study room,
 * whose setting lets them start (anyone, or MANAGE_STUDY_ROOMS), from inside
 * it (each else FORBIDDEN with its reason). They are its Host; everyone in
 * the room then takes part from now, a Solo of theirs ended first and told
 * (`joined_room`, D-103). A room with a session not yet ended:
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
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort,
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

        // Their zones read before the transaction, for a Solo of theirs to count as it ends (D-103).
        const zone = zoneOf(this.users)
        const zones = new Map(
            await Promise.all(
                (await this.voiceRooms.peopleIn(channelId)).map(async ({ userId: id }) => [id, await zone(id)] as const)
            )
        )
        const { session, participantIds, yielded } = await this.sessions.startInRoom(
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
            async () => (await this.voiceRooms.peopleIn(channelId)).map((person) => person.userId),
            async (id) => zones.get(id) ?? zone(id)
        )
        for (const solo of yielded) tellChange(this.events, solo, 'end', null)
        this.events.publish(new FocusSessionChangedEvent(null, session, 'start', userId, null))
        // Where each one present is counted from: their minutes today grow from now (D-232).
        this.events.publish(new ParticipationOpenedEvent(participantIds))
        return sessionView(session, new Date())
    }
}

/**
 * The sessions of a server's rooms that can hold one no more, ended
 * (REQ-STUDY-02, D-227): each room read again as it is now, so a change
 * that did not touch it (a name, another room) ends nothing. A deleted
 * server's rooms are gone with it. One that fails is logged and left to
 * the sweep, which checks every room each minute: the others still end.
 * Returns how many ended.
 */
@CommandHandler(EndGoneRoomSessionsCommand)
export class EndGoneRoomSessionsHandler implements ICommandHandler<EndGoneRoomSessionsCommand> {
    private readonly logger = new Logger(EndGoneRoomSessionsHandler.name)

    constructor(
        @Inject(FOCUS_SESSION_REPOSITORY) private readonly sessions: FocusSessionRepositoryPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort,
        @Inject(STUDY_SETTINGS) private readonly settings: StudySettings,
        private readonly events: EventBus
    ) {}

    async execute({ serverId }: EndGoneRoomSessionsCommand): Promise<number> {
        const { sessions, channels, users, events } = this
        let ended = 0
        for (const session of await sessions.openInServer(serverId)) {
            if (!session.channelId) continue
            try {
                const sources = { sessions, channels, users, events, minuteMs: this.settings.minuteMs }
                if (await endIfRoomGone(sources, { id: session.id, channelId: session.channelId })) ended++
            } catch (error) {
                this.logger.error(`Session ${session.id} of a room gone not ended: ${String(error)}`)
            }
        }
        return ended
    }
}

export const ROOM_SESSION_COMMAND_HANDLERS = [StartRoomSessionHandler, EndGoneRoomSessionsHandler]
