import { Logger } from '@nestjs/common'
import { CommandBus } from '@nestjs/cqrs'
import { OnGatewayConnection, OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'
import { ERROR_TYPES } from '@/shared/constants/error-response'
import { DomainError } from '@/shared/domain/domain-error'
import { OpenConnectionCommand, OpenedConnection } from '@/modules/realtime/application'

/** What a socket carries once let in. */
interface ConnectionData {
    connection?: OpenedConnection
}

/**
 * The socket.io endpoint (SRS 5.2, ARCHITECTURE 3.1): one connection per tab,
 * opened with a ticket in the handshake's `auth`, never in the URL.
 *
 * An inbound adapter, like a controller: a handshake becomes one
 * OpenConnectionCommand, which decides; the gateway only joins the rooms it
 * returns and says `ready`. A refused handshake never connects: the client
 * gets `connect_error` with `data.type`, the same error type REST would send
 * (REALTIME_TICKET_INVALID: buy a new ticket; AUTH_TOKEN_REVOKED: the session
 * ended).
 *
 * Events go out through EVENT_PUBLISHER, not from here. CORS and the Redis
 * adapter come from RedisIoAdapter (configure-app.ts).
 */
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayInit<Server>, OnGatewayConnection<Socket> {
    private readonly logger = new Logger(RealtimeGateway.name)

    @WebSocketServer()
    server: Server

    constructor(private readonly commandBus: CommandBus) {}

    afterInit(server: Server): void {
        server.use((socket, next) => {
            const ticket = (socket.handshake.auth as { ticket?: unknown }).ticket
            this.commandBus
                .execute<OpenConnectionCommand, OpenedConnection>(
                    new OpenConnectionCommand(typeof ticket === 'string' ? ticket : '')
                )
                .then((connection) => {
                    ;(socket.data as ConnectionData).connection = connection
                    next()
                })
                .catch((error: unknown) => next(this.refusal(error)))
        })
    }

    async handleConnection(socket: Socket): Promise<void> {
        const { connection } = socket.data as ConnectionData
        // Never so: the handshake refuses a socket it did not let in.
        if (!connection) {
            socket.disconnect(true)
            return
        }
        await socket.join(connection.rooms)
        // Presence comes with L7, the study session with M4 (ARCHITECTURE 3.1 step 3).
        socket.emit('ready', { server_time: new Date().toISOString() })
    }

    /** The error a refused handshake ends with, typed as the REST API types it. */
    private refusal(error: unknown): Error {
        if (error instanceof DomainError) {
            return Object.assign(new Error(error.message), { data: { type: ERROR_TYPES[error.errorKey] } })
        }
        this.logger.error(`A socket could not connect: ${(error as Error)?.message}`)
        return Object.assign(new Error('Could not connect. Try again shortly.'), {
            data: { type: ERROR_TYPES.GENERIC }
        })
    }
}
