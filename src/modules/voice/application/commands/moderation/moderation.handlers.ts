import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { RoomModeration } from '../../services/room-moderation'
import { DisconnectParticipantCommand, MuteParticipantCommand, UnmuteParticipantCommand } from './moderation.commands'

/**
 * A moderator turning off someone's microphone (REQ-VC-04, D-207):
 * MUTE_MEMBERS in the room, on someone ranked lower. LiveKit stops the mic
 * they are sending and refuses another until they leave the room or are
 * unmuted; their icon shows them muted.
 */
@CommandHandler(MuteParticipantCommand)
export class MuteParticipantHandler extends RoomModeration implements ICommandHandler<MuteParticipantCommand> {
    execute({ actorId, channelId, targetId }: MuteParticipantCommand): Promise<void> {
        return this.setMuted(actorId, channelId, targetId, true)
    }
}

/** A moderator unmuting someone (D-207): they may turn their mic on again, if SPEAK lets them. */
@CommandHandler(UnmuteParticipantCommand)
export class UnmuteParticipantHandler extends RoomModeration implements ICommandHandler<UnmuteParticipantCommand> {
    execute({ actorId, channelId, targetId }: UnmuteParticipantCommand): Promise<void> {
        return this.setMuted(actorId, channelId, targetId, false)
    }
}

/**
 * A moderator putting someone out of a room (REQ-VC-04): MOVE_MEMBERS, on
 * someone ranked lower. Out of LiveKit and off the list at once, told
 * `voice.disconnected` with reason `moderator`; they may join again at once.
 */
@CommandHandler(DisconnectParticipantCommand)
export class DisconnectParticipantHandler
    extends RoomModeration
    implements ICommandHandler<DisconnectParticipantCommand>
{
    execute({ actorId, channelId, targetId }: DisconnectParticipantCommand): Promise<void> {
        return this.disconnect(actorId, channelId, targetId)
    }
}

export const MODERATION_COMMAND_HANDLERS = [
    MuteParticipantHandler,
    UnmuteParticipantHandler,
    DisconnectParticipantHandler
]
