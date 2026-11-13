import { Module, OnModuleInit } from '@nestjs/common'
import { CqrsModule } from '@nestjs/cqrs'
import { AuthModule } from '@/modules/auth/auth.module'
import { PermissionsModule } from '@/modules/permissions/permissions.module'
import { ServersModule } from '@/modules/servers/servers.module'
import {
    DisconnectEndedSessionsHandler,
    EVENT_PUBLISHER,
    IssueTicketHandler,
    OpenConnectionHandler,
    TICKET_STORE
} from './application'
import { RedisTicketStore, SocketIoEventPublisher } from './infrastructure'
import { RealtimeController, RealtimeGateway } from './presentation'

/**
 * The socket side of the app (SRS 5.2, ARCHITECTURE 3): the ticket route,
 * the gateway that lets sockets in and puts them in their rooms, and the
 * EVENT_PUBLISHER every other module sends events through.
 *
 * REDIS_CLIENT comes from the global CacheModule; PRINCIPAL from auth,
 * MEMBERSHIP from servers, PERMISSION_CHECKER from permissions.
 */
@Module({
    imports: [CqrsModule, AuthModule, ServersModule, PermissionsModule],
    controllers: [RealtimeController],
    providers: [
        { provide: TICKET_STORE, useClass: RedisTicketStore },
        SocketIoEventPublisher,
        { provide: EVENT_PUBLISHER, useExisting: SocketIoEventPublisher },
        IssueTicketHandler,
        OpenConnectionHandler,
        DisconnectEndedSessionsHandler,
        RealtimeGateway
    ],
    exports: [EVENT_PUBLISHER]
})
export class RealtimeModule implements OnModuleInit {
    constructor(
        private readonly gateway: RealtimeGateway,
        private readonly publisher: SocketIoEventPublisher
    ) {}

    /** The gateway's server exists by now (Nest starts gateways before this hook). */
    onModuleInit(): void {
        this.publisher.attach(this.gateway.server)
    }
}
