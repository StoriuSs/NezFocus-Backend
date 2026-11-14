import { Module } from '@nestjs/common'
import { CqrsModule } from '@nestjs/cqrs'
import { PermissionsModule } from '@/modules/permissions/permissions.module'
import { RealtimeModule } from '@/modules/realtime/realtime.module'
import { ServersModule } from '@/modules/servers/servers.module'
import { UsersModule } from '@/modules/users/users.module'
import { RateLimiter } from '@/shared/infrastructure/rate-limit/rate-limiter'
import { MESSAGE_REPOSITORY, PIN_REPOSITORY, REACTION_REPOSITORY } from './domain'
import {
    MESSAGE_COMMAND_HANDLERS,
    MESSAGE_QUERY_HANDLERS,
    PIN_COMMAND_HANDLERS,
    PIN_QUERY_HANDLERS,
    PublishCreatedMessageHandler,
    PublishDeletedMessageHandler,
    PublishPinsUpdatedHandler,
    PublishReactionAddedHandler,
    PublishReactionRemovedHandler,
    PublishUpdatedMessageHandler,
    REACTION_COMMAND_HANDLERS,
    REACTION_QUERY_HANDLERS,
    SEND_LIMIT
} from './application'
import { PrismaMessageRepository, PrismaPinRepository, PrismaReactionRepository } from './infrastructure'
import { MessageController, MessagingController, PinController } from './presentation'

/**
 * Messages in text channels (SRS 4.4): the only module that writes the
 * messaging tables. Asks servers which server a channel is in
 * (CHANNEL_DIRECTORY), permissions what someone may do there
 * (PERMISSION_CHECKER), users for pictures as addresses (USER_DIRECTORY), and
 * tells the channel's sockets through realtime's EVENT_PUBLISHER.
 */
@Module({
    imports: [CqrsModule, PermissionsModule, RealtimeModule, ServersModule, UsersModule],
    controllers: [MessagingController, MessageController, PinController],
    providers: [
        { provide: MESSAGE_REPOSITORY, useClass: PrismaMessageRepository },
        { provide: REACTION_REPOSITORY, useClass: PrismaReactionRepository },
        { provide: PIN_REPOSITORY, useClass: PrismaPinRepository },
        // RateLimiter comes from the global CacheModule.
        { provide: SEND_LIMIT, useExisting: RateLimiter },
        ...MESSAGE_COMMAND_HANDLERS,
        ...MESSAGE_QUERY_HANDLERS,
        ...REACTION_COMMAND_HANDLERS,
        ...REACTION_QUERY_HANDLERS,
        ...PIN_COMMAND_HANDLERS,
        ...PIN_QUERY_HANDLERS,
        PublishCreatedMessageHandler,
        PublishUpdatedMessageHandler,
        PublishDeletedMessageHandler,
        PublishReactionAddedHandler,
        PublishReactionRemovedHandler,
        PublishPinsUpdatedHandler
    ]
})
export class MessagingModule {}
