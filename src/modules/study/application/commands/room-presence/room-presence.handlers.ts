import { Inject } from '@nestjs/common'
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { CHANNEL_DIRECTORY, ChannelDirectoryPort } from '@/modules/servers'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { FOCUS_SESSION_REPOSITORY, FocusSessionRepositoryPort } from '../../../domain'
import { joinStudyRoom, tellPresence } from '../../services/change-presence'
import { zoneOf } from '../../services/change-session'
import { mayHostWith } from '../../services/study-access'
import { JoinStudyRoomCommand, LeaveStudyRoomCommand } from './room-presence.commands'

/**
 * Someone came into a voice room (ARCHITECTURE 5.2, REQ-STUDY-02): they take
 * part in its session, if it has one, after any place still open in another
 * room's session is closed (joinStudyRoom, D-215).
 */
@CommandHandler(JoinStudyRoomCommand)
export class JoinStudyRoomHandler implements ICommandHandler<JoinStudyRoomCommand> {
    constructor(
        @Inject(FOCUS_SESSION_REPOSITORY) private readonly sessions: FocusSessionRepositoryPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly checker: PermissionCheckerPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort,
        private readonly events: EventBus
    ) {}

    async execute({ channelId, userId }: JoinStudyRoomCommand): Promise<void> {
        const { sessions, users, events } = this
        const mayHost = mayHostWith({ channels: this.channels, checker: this.checker })
        await joinStudyRoom({ sessions, users, events, mayHost }, channelId, userId)
    }
}

/**
 * Someone went out of a voice room (ARCHITECTURE 5.2, D-215): their
 * connection lost, they are away and keep their place and their Host 3
 * minutes; else their place is counted and closed now, and a Host gone
 * hands over to whoever came first of those present who may start a
 * session (REQ-STUDY-03). Nobody present after it: the room is empty, and
 * its session ends 5 minutes on (D-227). Asked to leave with no room named
 * (D-228): the place they have in any room, away or not. Not in a session
 * there: nothing.
 */
@CommandHandler(LeaveStudyRoomCommand)
export class LeaveStudyRoomHandler implements ICommandHandler<LeaveStudyRoomCommand> {
    constructor(
        @Inject(FOCUS_SESSION_REPOSITORY) private readonly sessions: FocusSessionRepositoryPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly checker: PermissionCheckerPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort,
        private readonly events: EventBus
    ) {}

    async execute({ channelId, userId, lost, requestedAt }: LeaveStudyRoomCommand): Promise<void> {
        const mayHost = mayHostWith({ channels: this.channels, checker: this.checker })
        const from =
            channelId === null ? { anyRoom: true as const, requestedAt: requestedAt ?? new Date() } : { channelId }
        tellPresence(this.events, await this.sessions.leave(from, userId, lost, mayHost, zoneOf(this.users)))
    }
}

export const ROOM_PRESENCE_COMMAND_HANDLERS = [JoinStudyRoomHandler, LeaveStudyRoomHandler]
