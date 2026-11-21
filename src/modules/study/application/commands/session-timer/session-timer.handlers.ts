import { Inject, Logger } from '@nestjs/common'
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { CHANNEL_DIRECTORY, ChannelDirectoryPort } from '@/modules/servers'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { VOICE_ROOMS, VoiceRoomsPort } from '@/modules/voice'
import {
    AWAY_MINUTES,
    EMPTY_MINUTES,
    emptyEndMove,
    FOCUS_SESSION_REPOSITORY,
    FocusSessionRepositoryPort,
    OpenRoom,
    phaseEndMove
} from '../../../domain'
import { closeAwayPlace, joinStudyRoom, PresenceSources, tellPresence } from '../../services/change-presence'
import { changeSession, ChangeSources, zoneOf } from '../../services/change-session'
import { endIfRoomGone, GoneRoomSources } from '../../services/end-gone-rooms'
import { mayHostWith } from '../../services/study-access'
import { STUDY_SETTINGS, StudySettings } from '../../study-settings'
import {
    CloseAwayCommand,
    EndEmptyRoomCommand,
    EndFocusPhaseCommand,
    SweepStudyTimersCommand
} from './session-timer.commands'

/** How many of each timer one sweep runs: the next run takes the rest (each one run leaves the list). */
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

/** The end of a room empty since `since`, decided on the session once locked (emptyEndMove): true when it ended. */
async function endEmpty(sources: ChangeSources, minuteMs: number, sessionId: string, since: Date): Promise<boolean> {
    const change = await changeSession(
        sources,
        sessionId,
        null,
        (session, at) => emptyEndMove(session, since, at, minuteMs),
        'end',
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
 * The place of one away since `since`, 3 minutes on (D-215): read again
 * under the locks, and left alone if they came back, left or went away again
 * since, or run early (closeAwayPlace). Else counted up to when they went
 * away and closed there; a Host hands over (REQ-STUDY-03).
 */
@CommandHandler(CloseAwayCommand)
export class CloseAwayHandler implements ICommandHandler<CloseAwayCommand> {
    constructor(
        @Inject(FOCUS_SESSION_REPOSITORY) private readonly sessions: FocusSessionRepositoryPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly checker: PermissionCheckerPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort,
        @Inject(STUDY_SETTINGS) private readonly settings: StudySettings,
        private readonly events: EventBus
    ) {}

    async execute({ participationId, since }: CloseAwayCommand): Promise<void> {
        const { sessions, users, events } = this
        const mayHost = mayHostWith({ channels: this.channels, checker: this.checker })
        await closeAwayPlace(
            { sessions, users, events, mayHost },
            this.settings.minuteMs,
            participationId,
            since,
            new Date()
        )
    }
}

/**
 * The session of a room empty since `since`, 5 minutes on (REQ-STUDY-02,
 * D-227): read again under its lock, and left alone if someone came in, or
 * it went empty again later (that has its own job). Else it ends (`empty`),
 * the phase ends it missed first, everyone counted, the room told.
 */
@CommandHandler(EndEmptyRoomCommand)
export class EndEmptyRoomHandler implements ICommandHandler<EndEmptyRoomCommand> {
    constructor(
        @Inject(FOCUS_SESSION_REPOSITORY) private readonly sessions: FocusSessionRepositoryPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort,
        @Inject(STUDY_SETTINGS) private readonly settings: StudySettings,
        private readonly events: EventBus
    ) {}

    async execute({ sessionId, since }: EndEmptyRoomCommand): Promise<void> {
        const { sessions, users, events } = this
        await endEmpty({ sessions, users, events }, this.settings.minuteMs, sessionId, since)
    }
}

/**
 * The study timers already due whose job was lost (Redis down when it was
 * set, the app stopped between the commit and setting it) or is late
 * (D-225), each run as its job would, so a job that comes meanwhile finds
 * it done and does nothing: the phase ends, the rooms empty 5 minutes, the
 * places away 3 minutes. A session caught up from far behind moves a phase
 * per run here, its next job set each time with no delay.
 *
 * Then every room with a session, read again as it is: one that can hold
 * it no more ends (D-227: its change event lost); and who is present is set
 * against who is in the room, since voice's events live in memory and are
 * lost when the app stops: one present but no longer there is away from
 * now (as a lost connection, D-215), one there but not present joins, as a
 * join would (joinStudyRoom: a place elsewhere closed first). Every room
 * each run: a room checked stays in the list.
 *
 * One that fails is logged and left for the next run: the others are still
 * made. Returns how many timers it ran; the rooms it set right are logged.
 */
@CommandHandler(SweepStudyTimersCommand)
export class SweepStudyTimersHandler implements ICommandHandler<SweepStudyTimersCommand> {
    private readonly logger = new Logger(SweepStudyTimersHandler.name)

    constructor(
        @Inject(FOCUS_SESSION_REPOSITORY) private readonly sessions: FocusSessionRepositoryPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly checker: PermissionCheckerPort,
        @Inject(VOICE_ROOMS) private readonly voiceRooms: VoiceRoomsPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort,
        @Inject(STUDY_SETTINGS) private readonly settings: StudySettings,
        private readonly events: EventBus
    ) {}

    async execute({ now }: SweepStudyTimersCommand): Promise<number> {
        const { sessions, channels, users, events } = this
        const { minuteMs } = this.settings
        const sources: GoneRoomSources = { sessions, channels, users, events, minuteMs }
        const mayHost = mayHostWith({ channels, checker: this.checker })
        const presence: PresenceSources = { sessions, users, events, mayHost }
        /** Runs each item, logging one that fails; how many changed something. */
        const each = async <T>(items: T[], what: (item: T) => string, run: (item: T) => Promise<boolean>) => {
            let changed = 0
            for (const item of items) {
                try {
                    if (await run(item)) changed++
                } catch (error) {
                    this.logger.error(`${what(item)} failed: ${String(error)}`)
                }
            }
            return changed
        }

        const phaseEnds = await each(
            await sessions.overdue(now, SWEEP_LIMIT),
            ({ id }) => `The phase end of session ${id}`,
            ({ id, version }) => endPhase(sources, minuteMs, id, version)
        )
        const emptyEnds = await each(
            await sessions.emptySince(new Date(now.getTime() - EMPTY_MINUTES * minuteMs), SWEEP_LIMIT),
            ({ id }) => `The end of empty session ${id}`,
            ({ id, emptySince }) => endEmpty(sources, minuteMs, id, emptySince)
        )
        const awayClosed = await each(
            await sessions.awaySince(new Date(now.getTime() - AWAY_MINUTES * minuteMs), SWEEP_LIMIT),
            ({ id }) => `The close of away participation ${id}`,
            ({ id, awaySince }) => closeAwayPlace(presence, minuteMs, id, awaySince, now)
        )
        const roomsSet = await each(
            await sessions.openRooms(),
            ({ sessionId }) => `The room check of session ${sessionId}`,
            (room) => this.checkRoom(sources, presence, room)
        )
        // Each is an event lost: worth seeing.
        if (roomsSet > 0) this.logger.warn(`${roomsSet} rooms with a session set right (a room gone, or who is in it)`)
        return phaseEnds + emptyEnds + awayClosed
    }

    /** One room with a session as it is now: gone, or who is present set right. True when it changed anything. */
    private async checkRoom(sources: GoneRoomSources, presence: PresenceSources, room: OpenRoom): Promise<boolean> {
        if (await endIfRoomGone(sources, { id: room.sessionId, channelId: room.channelId })) return true
        const inRoom = new Set((await this.voiceRooms.peopleIn(room.channelId)).map(({ userId }) => userId))
        const present = new Set(room.present)
        let changed = false
        for (const userId of room.present) {
            if (inRoom.has(userId)) continue
            const change = await this.sessions.leave(
                { sessionId: room.sessionId },
                userId,
                true,
                presence.mayHost,
                zoneOf(this.users)
            )
            tellPresence(this.events, change)
            changed ||= change !== null
        }
        for (const userId of inRoom) {
            if (present.has(userId)) continue
            changed = (await joinStudyRoom(presence, room.channelId, userId)) || changed
        }
        return changed
    }
}

export const SESSION_TIMER_COMMAND_HANDLERS = [
    EndFocusPhaseHandler,
    CloseAwayHandler,
    EndEmptyRoomHandler,
    SweepStudyTimersHandler
]
