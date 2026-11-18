import { Logger } from '@nestjs/common'
import { CommandBus } from '@nestjs/cqrs'
import {
    ConnectedSocket,
    MessageBody,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnGatewayInit,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer
} from '@nestjs/websockets'
import { isUUID } from 'class-validator'
import { Server, Socket } from 'socket.io'
import { ERROR_TYPES } from '@/shared/constants/error-response'
import { DomainError } from '@/shared/domain/domain-error'
import {
    ConnectPresenceCommand,
    DisconnectPresenceCommand,
    HeartbeatCommand,
    OpenConnectionCommand,
    OpenedConnection,
    ReportIdleCommand,
    ReportTypingCommand,
    ReportVoiceStateCommand,
    SettleRoomsCommand
} from '@/modules/realtime/application'
import { type Presence, takeSignal } from '@/modules/realtime/domain'

/** What a socket carries once let in. */
interface ConnectionData {
    connection?: OpenedConnection
    /** When this socket last said it went unused or back (`presence.idle`), in ms. */
    idleSaidAt?: number
    /** When the signals it sent in the last window were taken, in ms (signal.rules.ts). */
    signalsAt?: number[]
}

/** `presence.idle` is taken at most this often per socket. */
const IDLE_EVERY_MS = 1000

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
 *
 * A tab also sends light signals (SRS 5.2): `heartbeat`, `presence.idle`,
 * `typing.start`, `voice.self_state`. Each becomes one command. One that is malformed is
 * ignored: the socket stays. Before anything else, each is counted against
 * one limit per socket for every signal (SIGNALS_PER_WINDOW): one over it is
 * ignored the same way, costing no Redis and no SQL. `presence.idle` is also
 * taken at most once a second per socket: a tab flipping it costs its
 * servers nothing more.
 */
@WebSocketGateway()
export class RealtimeGateway
    implements OnGatewayInit<Server>, OnGatewayConnection<Socket>, OnGatewayDisconnect<Socket>
{
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
        // What changed while it connected (D-178): moved again now that later moves find it.
        await this.commandBus.execute(new SettleRoomsCommand(connection.userId, connection.rooms))
        const status = await this.commandBus.execute<ConnectPresenceCommand, Presence>(
            new ConnectPresenceCommand(connection.userId, socket.id)
        )
        // The study session comes with M4 (ARCHITECTURE 3.1 step 3).
        socket.emit('ready', { server_time: new Date().toISOString(), status })
    }

    async handleDisconnect(socket: Socket): Promise<void> {
        const { connection } = socket.data as ConnectionData
        if (connection) await this.commandBus.execute(new DisconnectPresenceCommand(connection.userId, socket.id))
    }

    /** Every 30 seconds while the tab is open (ARCHITECTURE 3.3). */
    @SubscribeMessage('heartbeat')
    async heartbeat(@ConnectedSocket() socket: Socket): Promise<void> {
        if (!this.takes(socket)) return
        const { connection } = socket.data as ConnectionData
        if (connection) await this.commandBus.execute(new HeartbeatCommand(connection.userId, socket.id))
    }

    /** `{ idle: true }` after 10 minutes unused, `{ idle: false }` once in use again (REQ-AUTH-07). */
    @SubscribeMessage('presence.idle')
    async idle(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<void> {
        if (!this.takes(socket)) return
        const { connection } = socket.data as ConnectionData
        const data = socket.data as ConnectionData
        const idle = (body as { idle?: unknown } | null)?.idle
        if (!connection || typeof idle !== 'boolean') return
        const now = Date.now()
        if (now - (data.idleSaidAt ?? 0) < IDLE_EVERY_MS) return
        data.idleSaidAt = now
        await this.commandBus.execute(new ReportIdleCommand(connection.userId, socket.id, idle))
    }

    /** `{ channel_id }` while typing there (REQ-MSG-06); messaging decides whether it is told. */
    @SubscribeMessage('typing.start')
    async typing(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<void> {
        if (!this.takes(socket)) return
        const { connection } = socket.data as ConnectionData
        const channelId = (body as { channel_id?: unknown } | null)?.channel_id
        if (!connection || typeof channelId !== 'string' || !isUUID(channelId)) return
        await this.commandBus.execute(new ReportTypingCommand(connection.userId, socket.id, channelId))
    }

    /** `{ mic, camera }` when the tab's own microphone or camera goes on or off in a voice room (D-206). */
    @SubscribeMessage('voice.self_state')
    async voiceState(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<void> {
        if (!this.takes(socket)) return
        const { connection } = socket.data as ConnectionData
        const { mic, camera } = (body as { mic?: unknown; camera?: unknown } | null) ?? {}
        if (!connection || typeof mic !== 'boolean' || typeof camera !== 'boolean') return
        await this.commandBus.execute(new ReportVoiceStateCommand(connection.userId, mic, camera))
    }

    /** Counts a signal of this socket: false when it is over the limit, to be ignored. */
    private takes(socket: Socket): boolean {
        const data = socket.data as ConnectionData
        const { taken, takenAt } = takeSignal(data.signalsAt ?? [], Date.now())
        data.signalsAt = takenAt
        return taken
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
