import { Inject } from '@nestjs/common'
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { CHANNEL_DIRECTORY, ChannelDirectoryPort } from '@/modules/servers'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { VOICE_STATE_REPOSITORY, VoiceStateRepositoryPort, voiceRoomOf } from '../../../domain'
import { VoiceLeaveRequestedEvent } from '../../events/voice-leave-requested.event'
import { ACTIVE_CALLS, ActiveCallsPort, MEDIA_ROOMS, MediaRoomsPort } from '../../ports'
import { leaveRoom } from '../../services/leave-room'
import { mediaNameOf } from '../../services/media-name'
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
 * leaving: the client asks only on "Vào phòng". The active call one is in
 * ends first too (D-242, D-246): asked of social through ACTIVE_CALLS, so
 * the browser never holds a call and a room at once; the client asks before
 * (spec 09). A call still ringing is left. The same room in another tab
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
        private readonly events: EventBus,
        @Inject(ACTIVE_CALLS) private readonly calls: ActiveCallsPort
    ) {}

    async execute({ userId, channelId, sessionId }: IssueJoinTokenCommand): Promise<JoinToken> {
        const { sources } = await openRoom(
            { channels: this.channels, checker: this.checker },
            channelId,
            userId,
            new Date()
        )
        await this.calls.endFor(userId)
        const current = await this.states.find(userId)
        if (current && current.channelId !== channelId) {
            await leaveRoom({ media: this.media, states: this.states, events: this.events }, current)
        }
        const name = await mediaNameOf(this.users, userId)
        return this.media.issueJoinToken({ room: voiceRoomOf(channelId), identity: userId, name, sources, sessionId })
    }
}

/**
 * Leaving the room one is in (REQ-VC-02): put out of LiveKit and taken off
 * the room's list at once, not when the webhook comes. In no room: nothing
 * to do, no error (a second tab may have left first, or LiveKit's leave,
 * as the page leaves LiveKit before it asks). Either way study is told the
 * leaving was meant (VoiceLeaveRequestedEvent, D-228).
 */
@CommandHandler(LeaveVoiceCommand)
export class LeaveVoiceHandler implements ICommandHandler<LeaveVoiceCommand> {
    constructor(
        @Inject(MEDIA_ROOMS) private readonly media: MediaRoomsPort,
        @Inject(VOICE_STATE_REPOSITORY) private readonly states: VoiceStateRepositoryPort,
        private readonly events: EventBus
    ) {}

    async execute({ userId }: LeaveVoiceCommand): Promise<void> {
        const requestedAt = new Date()
        const current = await this.states.find(userId)
        if (current) await leaveRoom({ media: this.media, states: this.states, events: this.events }, current)
        this.events.publish(new VoiceLeaveRequestedEvent(userId, requestedAt))
    }
}

export const CONNECTION_COMMAND_HANDLERS = [IssueJoinTokenHandler, LeaveVoiceHandler]
