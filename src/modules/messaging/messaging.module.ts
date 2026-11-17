import { Global, Module } from '@nestjs/common'
import { CqrsModule } from '@nestjs/cqrs'
import { UploadModule } from '@/shared/infrastructure/storage/upload.module'
import { QUEUES, registerQueues } from '@/shared/infrastructure/queue/queues'
import { PermissionsModule } from '@/modules/permissions/permissions.module'
import { RealtimeModule } from '@/modules/realtime/realtime.module'
import { ServersModule } from '@/modules/servers/servers.module'
import { SYSTEM_MESSAGES } from '@/modules/servers'
import { MESSAGE_PREVIEWS } from '@/modules/notifications'
import { UsersModule } from '@/modules/users/users.module'
import { RateLimiter } from '@/shared/infrastructure/rate-limit/rate-limiter'
import {
    ATTACHMENT_REPOSITORY,
    MESSAGE_REPOSITORY,
    PIN_REPOSITORY,
    REACTION_REPOSITORY,
    READ_STATE_REPOSITORY
} from './domain'
import {
    ATTACHMENT_COMMAND_HANDLERS,
    ATTACHMENT_QUERY_HANDLERS,
    ATTACHMENT_STORAGE,
    DeleteBannedMessagesLaterHandler,
    FILE_CLEANUP,
    MarkSentMessageReadHandler,
    MESSAGE_PURGE,
    MESSAGE_COMMAND_HANDLERS,
    MESSAGE_QUERY_HANDLERS,
    NotifyChannelReadHandler,
    NotifyDeletedMessagesHandler,
    NotifyMessageMentionsHandler,
    PIN_COMMAND_HANDLERS,
    PIN_QUERY_HANDLERS,
    PublishBulkDeletedMessagesHandler,
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
    SEND_LIMIT,
    SYSTEM_MESSAGE_COMMAND_HANDLERS
} from './application'
import {
    AttachmentStorage,
    BullMqFileCleanup,
    BullMqMessagePurge,
    CommandBusSystemMessages,
    PrismaAttachmentRepository,
    PrismaMessageRepository,
    PrismaPinRepository,
    PrismaReactionRepository,
    PrismaReadStateRepository,
    QueryBusMessagePreviews
} from './infrastructure'
import {
    AttachmentController,
    MessageController,
    MessagingController,
    MessagingJobsConsumer,
    PinController,
    ReadStateController
} from './presentation'

/**
 * Messages in text channels (SRS 4.4): the only module that writes the
 * messaging tables. Asks servers which server a channel is in
 * (CHANNEL_DIRECTORY), permissions what someone may do there
 * (PERMISSION_CHECKER), when someone joined a server (MEMBERSHIP, for where
 * their unread starts, which of the people online are in a server, for
 * @here, and who views a channel, for @everyone and @role), users for pictures as addresses and the status chosen
 * (USER_DIRECTORY), realtime who is online (PRESENCE), and tells the
 * channel's sockets through realtime's EVENT_PUBLISHER. Typing comes from
 * realtime's TypingSignalledEvent. Files go to the storage under
 * UploadService (ATTACHMENT_STORAGE); those no message holds are deleted
 * through the file-cleanup queue, whose consumer lives in UploadModule.
 * Deletes a banned member's recent messages when servers says so
 * (MemberChangedEvent), through its own messaging queue (D-181).
 * Writes "X joined the server" when servers asks, through the global
 * SystemMessagesModule below (D-180).
 */
@Module({
    imports: [
        CqrsModule,
        UploadModule,
        PermissionsModule,
        RealtimeModule,
        ServersModule,
        UsersModule,
        registerQueues(QUEUES.FILE_CLEANUP, QUEUES.MESSAGING)
    ],
    controllers: [MessagingController, MessageController, PinController, ReadStateController, AttachmentController],
    providers: [
        { provide: MESSAGE_REPOSITORY, useClass: PrismaMessageRepository },
        { provide: ATTACHMENT_REPOSITORY, useClass: PrismaAttachmentRepository },
        { provide: ATTACHMENT_STORAGE, useClass: AttachmentStorage },
        { provide: FILE_CLEANUP, useClass: BullMqFileCleanup },
        { provide: MESSAGE_PURGE, useClass: BullMqMessagePurge },
        { provide: REACTION_REPOSITORY, useClass: PrismaReactionRepository },
        { provide: PIN_REPOSITORY, useClass: PrismaPinRepository },
        { provide: READ_STATE_REPOSITORY, useClass: PrismaReadStateRepository },
        // RateLimiter comes from the global CacheModule.
        { provide: SEND_LIMIT, useExisting: RateLimiter },
        ...ATTACHMENT_COMMAND_HANDLERS,
        ...ATTACHMENT_QUERY_HANDLERS,
        ...MESSAGE_COMMAND_HANDLERS,
        ...MESSAGE_QUERY_HANDLERS,
        ...REACTION_COMMAND_HANDLERS,
        ...REACTION_QUERY_HANDLERS,
        ...PIN_COMMAND_HANDLERS,
        ...PIN_QUERY_HANDLERS,
        ...READ_STATE_COMMAND_HANDLERS,
        ...READ_STATE_QUERY_HANDLERS,
        ...SYSTEM_MESSAGE_COMMAND_HANDLERS,
        PublishCreatedMessageHandler,
        PublishUpdatedMessageHandler,
        PublishDeletedMessageHandler,
        PublishBulkDeletedMessagesHandler,
        PublishReactionAddedHandler,
        PublishReactionRemovedHandler,
        PublishPinsUpdatedHandler,
        PublishReadStateUpdatedHandler,
        PublishTypingHandler,
        MarkSentMessageReadHandler,
        DeleteBannedMessagesLaterHandler,
        NotifyMessageMentionsHandler,
        NotifyDeletedMessagesHandler,
        NotifyChannelReadHandler,
        MessagingJobsConsumer
    ]
})
export class MessagingModule {}

/**
 * The servers module's SYSTEM_MESSAGES port, answered by this one (D-180).
 * Global, so ServersModule finds it without importing this module, which
 * imports ServersModule: the code depends one way only, messaging on
 * servers. The adapter only sends this module's command over the bus, so it
 * needs nothing but CqrsModule. AppModule imports it.
 */
@Global()
@Module({
    imports: [CqrsModule],
    providers: [{ provide: SYSTEM_MESSAGES, useClass: CommandBusSystemMessages }],
    exports: [SYSTEM_MESSAGES]
})
export class SystemMessagesModule {}

/**
 * Notifications' MESSAGE_PREVIEWS port, answered by this module (D-198):
 * the messages inbox items show. Global, so NotificationsModule finds it
 * without importing this module, which calls NOTIFIER: the code depends one
 * way only, messaging on notifications. The adapter only sends this
 * module's query over the bus, so it needs nothing but CqrsModule.
 * AppModule imports it.
 */
@Global()
@Module({
    imports: [CqrsModule],
    providers: [{ provide: MESSAGE_PREVIEWS, useClass: QueryBusMessagePreviews }],
    exports: [MESSAGE_PREVIEWS]
})
export class MessagePreviewsModule {}
