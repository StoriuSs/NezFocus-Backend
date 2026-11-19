import { Global, Logger, Module, OnApplicationBootstrap } from '@nestjs/common'
import { CommandBus, CqrsModule } from '@nestjs/cqrs'
import { PermissionsModule } from '@/modules/permissions/permissions.module'
import { RealtimeModule } from '@/modules/realtime/realtime.module'
import { ROOM_PEOPLE } from '@/modules/servers'
import { ServersModule } from '@/modules/servers/servers.module'
import { UsersModule } from '@/modules/users/users.module'
import { VOICE_STATE_REPOSITORY } from './domain'
import {
    CONNECTION_COMMAND_HANDLERS,
    EVENT_RECEIPTS,
    MEDIA_EVENT_COMMAND_HANDLERS,
    LeaveDeletedAccountRoomHandler,
    MEDIA_EVENTS,
    MEDIA_ROOMS,
    MODERATION_COMMAND_HANDLERS,
    PublishRoomPeopleHandler,
    RecheckMemberRoomHandler,
    RecheckServerRoomsHandler,
    RECONCILE_COMMAND_HANDLERS,
    ReconcileVoiceRoomsCommand,
    RecordSelfStateHandler,
    ROOM_QUERY_HANDLERS
} from './application'
import {
    LiveKitMediaEvents,
    LiveKitMediaRooms,
    PrismaVoiceStateRepository,
    QueryBusRoomPeople,
    RedisEventReceipts
} from './infrastructure'
import { LiveKitWebhookController, VoiceController } from './presentation'

/**
 * Voice rooms (SRS 4.5, ARCHITECTURE 4): LiveKit carries the media; this
 * module gives the tokens to join (MEDIA_ROOMS), keeps who is in which room
 * (VoiceState) from LiveKit's webhooks (MEDIA_EVENTS, each taken once with
 * EVENT_RECEIPTS) and a reconciliation every minute, and tells each room's
 * viewers its people through realtime's EVENT_PUBLISHER (D-205). Moderators
 * mute and put people out (D-207); a kick, ban, timeout, lost permission or
 * deleted room puts them out too, as servers' and auth's events say (D-212).
 *
 * Asks servers where a channel is (CHANNEL_DIRECTORY), permissions what
 * someone may do there (PERMISSION_CHECKER), users the names and pictures
 * (USER_DIRECTORY). Answers servers' ROOM_PEOPLE through RoomPeopleModule
 * below. ConfigService comes from the global ConfigModule (livekit.config.ts),
 * REDIS_CLIENT from the global CacheModule.
 */
@Module({
    imports: [CqrsModule, PermissionsModule, RealtimeModule, ServersModule, UsersModule],
    controllers: [VoiceController, LiveKitWebhookController],
    providers: [
        { provide: MEDIA_ROOMS, useClass: LiveKitMediaRooms },
        { provide: MEDIA_EVENTS, useClass: LiveKitMediaEvents },
        { provide: EVENT_RECEIPTS, useClass: RedisEventReceipts },
        { provide: VOICE_STATE_REPOSITORY, useClass: PrismaVoiceStateRepository },
        ...CONNECTION_COMMAND_HANDLERS,
        ...MEDIA_EVENT_COMMAND_HANDLERS,
        ...MODERATION_COMMAND_HANDLERS,
        ...RECONCILE_COMMAND_HANDLERS,
        ...ROOM_QUERY_HANDLERS,
        PublishRoomPeopleHandler,
        RecordSelfStateHandler,
        RecheckMemberRoomHandler,
        RecheckServerRoomsHandler,
        LeaveDeletedAccountRoomHandler
    ]
})
export class VoiceModule implements OnApplicationBootstrap {
    private readonly logger = new Logger(VoiceModule.name)

    constructor(private readonly commandBus: CommandBus) {}

    /**
     * Webhooks sent while the API was down are lost (D-210): set the rows
     * right once now rather than at the first scheduled run. Not awaited: a
     * LiveKit that cannot be reached must not hold the API from starting.
     */
    onApplicationBootstrap(): void {
        this.commandBus.execute(new ReconcileVoiceRoomsCommand(new Date())).catch((error: unknown) => {
            this.logger.warn(`Voice rooms not reconciled at start: ${(error as Error).message}`)
        })
    }
}

/**
 * Servers' ROOM_PEOPLE port (the people of each voice room in GET /servers,
 * D-205), answered by this module. Global, so ServersModule finds it
 * without importing this module, which imports ServersModule: the code
 * depends one way only, voice on servers (as D-180). The adapter only sends
 * this module's query over the bus, so it needs nothing but CqrsModule.
 * AppModule imports it.
 */
@Global()
@Module({
    imports: [CqrsModule],
    providers: [{ provide: ROOM_PEOPLE, useClass: QueryBusRoomPeople }],
    exports: [ROOM_PEOPLE]
})
export class RoomPeopleModule {}
