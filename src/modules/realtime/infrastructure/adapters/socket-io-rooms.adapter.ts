import { Injectable, Logger } from '@nestjs/common'
import { Server } from 'socket.io'
import type { OpenedConnection } from '@/modules/realtime/application'
import { SocketRoomsPort } from '@/modules/realtime/application/ports'
import { userRoom } from '@/modules/realtime/domain'

/** What the gateway keeps on each socket it let in (RealtimeGateway): the connection OpenConnection answered. */
interface ConnectionData {
    connection?: Pick<OpenedConnection, 'userId'>
}

/**
 * SocketRoomsPort over the gateway's socket.io server. `fetchSockets` and
 * `socketsLeave` / `socketsJoin` go through the Redis adapter, so sockets on
 * every instance are found and moved. Attached by RealtimeModule, like the
 * event publisher; before that (nothing is connected) nothing moves.
 */
@Injectable()
export class SocketIoRooms implements SocketRoomsPort {
    private readonly logger = new Logger(SocketIoRooms.name)
    private server: Server | undefined

    attach(server: Server): void {
        this.server = server
    }

    async usersIn(room: string): Promise<string[]> {
        if (!this.server) return []
        const sockets = await this.server.in(room).fetchSockets()
        const users = sockets.map((socket) => (socket.data as ConnectionData).connection?.userId)
        return [...new Set(users.filter((userId): userId is string => userId !== undefined))]
    }

    /**
     * The sockets on this instance move at once, so an event sent right
     * after reaches the right rooms (the Redis adapter would move them only
     * once its own request came back through Redis, after that event). The
     * same request then goes to the other instances; back here it changes
     * nothing more.
     */
    move(userId: string, leave: string[], join: string[]): Promise<void> {
        if (!this.server) {
            this.logger.warn('Moved no socket: the socket server has not started')
            return Promise.resolve()
        }
        for (const sockets of [this.server.local.in(userRoom(userId)), this.server.in(userRoom(userId))]) {
            if (leave.length > 0) sockets.socketsLeave(leave)
            if (join.length > 0) sockets.socketsJoin(join)
        }
        return Promise.resolve()
    }
}
