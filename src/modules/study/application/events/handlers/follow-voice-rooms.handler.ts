import { Logger } from '@nestjs/common'
import { CommandBus, EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { VoiceLeaveRequestedEvent, VoiceStateChangedEvent } from '@/modules/voice'
import { JoinStudyRoomCommand, LeaveStudyRoomCommand } from '../../commands/room-presence/room-presence.commands'

/**
 * Who comes into and goes out of the voice rooms, as voice tells it after
 * each commit (ARCHITECTURE 5.2): a join takes part in the room's session, a
 * leaving closes the place now, or keeps it 3 minutes when the connection
 * was lost (D-215). A change of icons is nothing here. Every voice room is
 * heard: the commands find whether it has a session. One who asked to leave
 * their room (`POST /voice/leave`) leaves meaning it, even when LiveKit's
 * leave came first and was told as lost (D-228).
 *
 * Not retried (adding-a-module.md › Events): the sweep sets who is present
 * against who is in each room every minute (D-225).
 */
@EventsHandler(VoiceStateChangedEvent, VoiceLeaveRequestedEvent)
export class FollowVoiceRoomsHandler implements IEventHandler<VoiceStateChangedEvent | VoiceLeaveRequestedEvent> {
    private readonly logger = new Logger(FollowVoiceRoomsHandler.name)

    constructor(private readonly commandBus: CommandBus) {}

    async handle(event: VoiceStateChangedEvent | VoiceLeaveRequestedEvent): Promise<void> {
        const command =
            event instanceof VoiceLeaveRequestedEvent
                ? new LeaveStudyRoomCommand(null, event.userId, false)
                : event.change === 'joined'
                  ? new JoinStudyRoomCommand(event.channelId, event.userId)
                  : event.change === 'left'
                    ? new LeaveStudyRoomCommand(event.channelId, event.userId, event.lost)
                    : null
        if (!command) return
        try {
            await this.commandBus.execute(command)
        } catch (error) {
            this.logger.warn(`${command.constructor.name} of ${event.userId} not taken: ${String(error)}`)
        }
    }
}
