import { Inject } from '@nestjs/common'
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { CHANNEL_DIRECTORY, ChannelDirectoryPort } from '@/modules/servers'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { isHidden } from '@/shared/domain'
import { VOICE_STATE_REPOSITORY, VoiceStateRepositoryPort, voiceRoomOf } from '../../../domain'
import { MEDIA_ROOMS, MediaRoomsPort } from '../../ports'
import { leaveRoom } from '../../services/leave-room'
import { openRoom } from '../../services/room-access'
import { IssueJoinTokenCommand, LeaveVoiceCommand } from './connection.commands'

/** A join token, and where to connect with it (SRS 5.1 `POST /voice/token`). */
export interface JoinToken {
    token: string
    url: string
}

/**
 * A token to join a voice room (REQ-VC-01, D-210): for one who may CONNECT,
 * sending only what SPEAK and VIDEO allow. Someone in another room is put
 * out of it first (one connection per account), so asking for a token is
 * leaving: the client asks only on "Vào phòng". The same room in another tab
 * needs nothing here: LiveKit lets one connection per identity in a room,
 * and pushes the older out.
 *
 * Nothing is written for the room asked for: the row comes with LiveKit's
 * participant_joined, once the browser is really in.
 */
@CommandHandler(IssueJoinTokenCommand)
export class IssueJoinTokenHandler implements ICommandHandler<IssueJoinTokenCommand> {
    constructor(
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly checker: PermissionCheckerPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort,
        @Inject(MEDIA_ROOMS) private readonly media: MediaRoomsPort,
        @Inject(VOICE_STATE_REPOSITORY) private readonly states: VoiceStateRepositoryPort,
        private readonly events: EventBus
    ) {}

    async execute({ userId, channelId }: IssueJoinTokenCommand): Promise<JoinToken> {
        const { sources } = await openRoom(
            { channels: this.channels, checker: this.checker },
            channelId,
            userId,
            new Date()
        )
        const current = await this.states.find(userId)
        if (current && current.channelId !== channelId) {
            await leaveRoom({ media: this.media, states: this.states, events: this.events }, current)
        }
        // The name everyone in the room sees: none for an account shown as deleted (D-182).
        const user = await this.users.findById(userId)
        const name = user && !isHidden(user) ? (user.displayName ?? user.username ?? '') : ''
        return this.media.issueJoinToken({ room: voiceRoomOf(channelId), identity: userId, name, sources })
    }
}

/**
 * Leaving the room one is in (REQ-VC-02): put out of LiveKit and taken off
 * the room's list at once, not when the webhook comes. In no room: nothing
 * to do, no error (a second tab may have left first).
 */
@CommandHandler(LeaveVoiceCommand)
export class LeaveVoiceHandler implements ICommandHandler<LeaveVoiceCommand> {
    constructor(
        @Inject(MEDIA_ROOMS) private readonly media: MediaRoomsPort,
        @Inject(VOICE_STATE_REPOSITORY) private readonly states: VoiceStateRepositoryPort,
        private readonly events: EventBus
    ) {}

    async execute({ userId }: LeaveVoiceCommand): Promise<void> {
        const current = await this.states.find(userId)
        if (current) await leaveRoom({ media: this.media, states: this.states, events: this.events }, current)
    }
}

export const CONNECTION_COMMAND_HANDLERS = [IssueJoinTokenHandler, LeaveVoiceHandler]
