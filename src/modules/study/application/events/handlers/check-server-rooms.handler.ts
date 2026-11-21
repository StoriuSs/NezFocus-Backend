import { Logger } from '@nestjs/common'
import { CommandBus, EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { ServerChangedEvent } from '@/modules/servers'
import { EndGoneRoomSessionsCommand } from '../../commands/room-session/room-session.commands'

/**
 * A server change that may leave a session without a room (REQ-STUDY-02,
 * D-227): a channel changed (its study room turned off) or deleted, or the
 * server deleted. The event names no channel (D-178), so the sessions of the
 * server's rooms are read again. Anything else (roles, invites, a name)
 * reads nothing.
 *
 * Not retried (adding-a-module.md › Events): the sweep checks every room
 * with a session each minute.
 */
@EventsHandler(ServerChangedEvent)
export class CheckServerRoomsHandler implements IEventHandler<ServerChangedEvent> {
    private readonly logger = new Logger(CheckServerRoomsHandler.name)

    constructor(private readonly commandBus: CommandBus) {}

    async handle({ serverId, changes }: ServerChangedEvent): Promise<void> {
        const mayEnd = changes.some(
            ({ topic, action }) =>
                (topic === 'channel' && (action === 'updated' || action === 'deleted')) ||
                (topic === 'server' && action === 'deleted')
        )
        if (!mayEnd) return
        try {
            await this.commandBus.execute(new EndGoneRoomSessionsCommand(serverId))
        } catch (error) {
            this.logger.warn(`The sessions of server ${serverId} not checked: ${String(error)}`)
        }
    }
}
