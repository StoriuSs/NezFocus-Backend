import { Global, Module, OnModuleInit } from '@nestjs/common'
import { CqrsModule } from '@nestjs/cqrs'
import { AuthModule } from '@/modules/auth/auth.module'
import { PermissionsModule } from '@/modules/permissions/permissions.module'
import { PRESENCE_READER } from '@/modules/servers'
import { ServersModule } from '@/modules/servers/servers.module'
import { UsersModule } from '@/modules/users/users.module'
import {
    AnnounceChosenPresenceHandler,
    DisconnectEndedSessionsHandler,
    EVENT_PUBLISHER,
    IssueTicketHandler,
    OpenConnectionHandler,
    ReportTypingHandler,
    PRESENCE,
    PRESENCE_COMMAND_HANDLERS,
    PRESENCE_STORE,
    TICKET_STORE
} from './application'
import { RedisPresenceStore, RedisTicketStore, SocketIoEventPublisher } from './infrastructure'
import { RealtimeController, RealtimeGateway } from './presentation'

/**
 * The socket side of the app (SRS 5.2, ARCHITECTURE 3): the ticket route,
 * the gateway that lets sockets in and puts them in their rooms, and the
 * EVENT_PUBLISHER every other module sends events through.
 *
 * Presence too (ARCHITECTURE 3.3): each tab's signals, the sweep, and
 * PRESENCE for other modules to read.
 *
 * REDIS_CLIENT comes from the global CacheModule; PRINCIPAL from auth,
 * MEMBERSHIP from servers, PERMISSION_CHECKER from permissions,
 * USER_DIRECTORY (the status one chose) from users.
 */
@Module({
    imports: [CqrsModule, AuthModule, ServersModule, PermissionsModule, UsersModule],
    controllers: [RealtimeController],
    providers: [
        { provide: TICKET_STORE, useClass: RedisTicketStore },
        RedisPresenceStore,
        { provide: PRESENCE_STORE, useExisting: RedisPresenceStore },
        { provide: PRESENCE, useExisting: RedisPresenceStore },
        SocketIoEventPublisher,
        { provide: EVENT_PUBLISHER, useExisting: SocketIoEventPublisher },
        IssueTicketHandler,
        OpenConnectionHandler,
        ReportTypingHandler,
        DisconnectEndedSessionsHandler,
        ...PRESENCE_COMMAND_HANDLERS,
        AnnounceChosenPresenceHandler,
        RealtimeGateway
    ],
    exports: [EVENT_PUBLISHER, PRESENCE]
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

/**
 * The servers module's PRESENCE_READER port (the member list, D-175; an
 * invite's online count), answered from presence here. Global, so
 * ServersModule finds it without importing this module, which imports
 * ServersModule: the code depends one way only (as D-160). Needs nothing
 * but Redis (global too). AppModule imports it.
 */
@Global()
@Module({
    providers: [{ provide: PRESENCE_READER, useClass: RedisPresenceStore }],
    exports: [PRESENCE_READER]
})
export class PresenceReaderModule {}
