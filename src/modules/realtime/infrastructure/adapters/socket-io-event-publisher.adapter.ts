import { Injectable, Logger } from '@nestjs/common'
import { Server } from 'socket.io'
import { toSnakeCaseKeys } from '@/shared/utils/case-keys.util'
import { EventPublisherPort } from '@/modules/realtime/application/ports'
import { channelRoom, serverRoom, sessionRoom, userRoom } from '@/modules/realtime/domain'

/**
 * EventPublisherPort over the gateway's socket.io server. The Redis adapter
 * (RedisIoAdapter) carries each emit to the sockets on every instance.
 *
 * The server exists only once the gateway has started, after the providers
 * are made: RealtimeModule attaches it. An event before that (none is
 * expected, nothing is connected yet) is dropped with a warning.
 */
@Injectable()
export class SocketIoEventPublisher implements EventPublisherPort {
    private readonly logger = new Logger(SocketIoEventPublisher.name)
    private server: Server | undefined

    attach(server: Server): void {
        this.server = server
    }

    toUser(userId: string, event: string, data: object): void {
        this.emit([userRoom(userId)], event, data)
    }

    toServer(serverId: string, event: string, data: object): void {
        this.emit([serverRoom(serverId)], event, data)
    }

    toChannel(channelId: string, event: string, data: object): void {
        this.emit([channelRoom(channelId)], event, data)
    }

    /**
     * The event first, then a disconnect packet: the client hears why, and
     * socket.io does not reconnect after a disconnect the server asked for
     * ("io server disconnect").
     */
    endSessions(sessionIds: string[]): void {
        if (sessionIds.length === 0) return
        const rooms = sessionIds.map(sessionRoom)
        this.emit(rooms, 'session.revoked', {})
        this.server?.in(rooms).disconnectSockets()
    }

    private emit(rooms: string[], event: string, data: object): void {
        if (!this.server) {
            this.logger.warn(`Dropped ${event}: the socket server has not started`)
            return
        }
        this.server.to(rooms).emit(event, toSnakeCaseKeys(data))
    }
}
