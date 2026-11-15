import { Inject, Logger } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { ServerChangedEvent } from '@/modules/servers'
import { serverRoom } from '@/modules/realtime/domain'
import { EVENT_PUBLISHER, EventPublisherPort, SOCKET_ROOMS, SocketRoomsPort } from '../../ports'
import { RoomMoves } from '../../services/room-moves'

/**
 * A change to a server, its channels, roles, links or ban list, told to its
 * members as `<topic>.<action> {server_id}` (SRS 5.2, D-178): each reads the
 * server again as they may see it. When who may view what may have changed,
 * everyone with a socket in the server is moved to the rooms they may be in
 * now, before hearing it. A deleted server is told first, then everyone
 * leaves its rooms: after that no one would hear it.
 *
 * Not retried (adding-a-module.md › Events): sockets that could not be moved
 * keep their rooms until they connect again; the change is told all the same.
 */
@EventsHandler(ServerChangedEvent)
export class PublishServerChangeHandler implements IEventHandler<ServerChangedEvent> {
    private readonly logger = new Logger(PublishServerChangeHandler.name)

    constructor(
        @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort,
        @Inject(SOCKET_ROOMS) private readonly rooms: SocketRoomsPort,
        private readonly roomMoves: RoomMoves
    ) {}

    async handle({ serverId, changes, viewChanged }: ServerChangedEvent): Promise<void> {
        const tell = () => {
            for (const { topic, action } of changes)
                this.publisher.toServer(serverId, `${topic}.${action}`, { serverId })
        }
        const deleted = changes.some(({ topic, action }) => topic === 'server' && action === 'deleted')
        if (deleted) tell()
        if (viewChanged) {
            try {
                await this.roomMoves.moveInto(serverId, await this.rooms.usersIn(serverRoom(serverId)))
            } catch (error) {
                this.logger.warn(`Sockets of server ${serverId} not moved: ${(error as Error)?.message}`)
            }
        }
        if (!deleted) tell()
    }
}
