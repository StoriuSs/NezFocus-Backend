import { Module } from '@nestjs/common'
import { CqrsModule } from '@nestjs/cqrs'
import { PermissionsModule } from '@/modules/permissions/permissions.module'
import { RealtimeModule } from '@/modules/realtime/realtime.module'
import { ServersModule } from '@/modules/servers/servers.module'
import { UsersModule } from '@/modules/users/users.module'
import { RateLimiter } from '@/shared/infrastructure/rate-limit/rate-limiter'
import { MESSAGE_REPOSITORY, PIN_REPOSITORY, REACTION_REPOSITORY, READ_STATE_REPOSITORY } from './domain'
import {
    MarkSentMessageReadHandler,
    MESSAGE_COMMAND_HANDLERS,
    MESSAGE_QUERY_HANDLERS,
    PIN_COMMAND_HANDLERS,
    PIN_QUERY_HANDLERS,
    PublishCreatedMessageHandler,
    PublishDeletedMessageHandler,
    PublishPinsUpdatedHandler,
    PublishReactionAddedHandler,
    PublishReactionRemovedHandler,
    PublishReadStateUpdatedHandler,
    PublishTypingHandler,
    PublishUpdatedMessageHandler,
    REACTION_COMMAND_HANDLERS,
    REACTION_QUERY_HANDLERS,
    READ_STATE_COMMAND_HANDLERS,
    READ_STATE_QUERY_HANDLERS,
    SEND_LIMIT
} from './application'
import {
    PrismaMessageRepository,
    PrismaPinRepository,
    PrismaReactionRepository,
    PrismaReadStateRepository
} from './infrastructure'
import { MessageController, MessagingController, PinController, ReadStateController } from './presentation'

/**
 * Messages in text channels (SRS 4.4): the only module that writes the
 * messaging tables. Asks servers which server a channel is in
 * (CHANNEL_DIRECTORY), permissions what someone may do there
 * (PERMISSION_CHECKER), when someone joined a server (MEMBERSHIP, for where
 * their unread starts, and which of the people online are in a server, for
 * @here), users for pictures as addresses and the status chosen
 * (USER_DIRECTORY), realtime who is online (PRESENCE), and tells the
 * channel's sockets through realtime's EVENT_PUBLISHER. Typing comes from
 * realtime's TypingSignalledEvent.
 */
@Module({
    imports: [CqrsModule, PermissionsModule, RealtimeModule, ServersModule, UsersModule],
    controllers: [MessagingController, MessageController, PinController, ReadStateController],
    providers: [
        { provide: MESSAGE_REPOSITORY, useClass: PrismaMessageRepository },
        { provide: REACTION_REPOSITORY, useClass: PrismaReactionRepository },
        { provide: PIN_REPOSITORY, useClass: PrismaPinRepository },
        { provide: READ_STATE_REPOSITORY, useClass: PrismaReadStateRepository },
        // RateLimiter comes from the global CacheModule.
        { provide: SEND_LIMIT, useExisting: RateLimiter },
        ...MESSAGE_COMMAND_HANDLERS,
        ...MESSAGE_QUERY_HANDLERS,
        ...REACTION_COMMAND_HANDLERS,
        ...REACTION_QUERY_HANDLERS,
        ...PIN_COMMAND_HANDLERS,
        ...PIN_QUERY_HANDLERS,
        ...READ_STATE_COMMAND_HANDLERS,
        ...READ_STATE_QUERY_HANDLERS,
        PublishCreatedMessageHandler,
        PublishUpdatedMessageHandler,
        PublishDeletedMessageHandler,
        PublishReactionAddedHandler,
        PublishReactionRemovedHandler,
        PublishPinsUpdatedHandler,
        PublishReadStateUpdatedHandler,
        PublishTypingHandler,
        MarkSentMessageReadHandler
    ]
})
export class MessagingModule {}
