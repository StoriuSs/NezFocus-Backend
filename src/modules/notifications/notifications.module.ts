import { Global, Module } from '@nestjs/common'
import { CqrsModule } from '@nestjs/cqrs'
import { PermissionsModule } from '@/modules/permissions/permissions.module'
import { RealtimeModule } from '@/modules/realtime/realtime.module'
import { ServersModule } from '@/modules/servers/servers.module'
import { UsersModule } from '@/modules/users/users.module'
import { NOTIFICATION_REPOSITORY } from './domain'
import {
    CleanUpNotificationsHandler,
    ForgetDeletedAccountItemsHandler,
    INBOX_QUERY_HANDLERS,
    ITEM_COMMAND_HANDLERS,
    NOTIFIER,
    PublishCreatedNotificationsHandler,
    PublishDeletedNotificationsHandler,
    PublishReadNotificationsHandler,
    READ_COMMAND_HANDLERS,
    SERVER_ITEM_COMMAND_HANDLERS,
    TASK_ITEM_COMMAND_HANDLERS
} from './application'
import { CommandBusNotifier, PrismaNotificationRepository } from './infrastructure'
import { NotificationsController } from './presentation'

/**
 * The inbox (SRS 4.8): the only module that writes Notification. Other
 * modules put items in through NOTIFIER (D-185): messaging for mentions and
 * replies, tasks for task items (D-98), servers for a server handed over
 * and for moderation (REQ-SRV-05, REQ-ROLE-04); the messages items are
 * about it reads through MESSAGE_PREVIEWS, answered by messaging (D-198).
 * Asks servers which servers someone is in (MEMBERSHIP), permissions which
 * channels they view (PERMISSION_CHECKER), users for pictures as addresses
 * (USER_DIRECTORY), and tells each person's tabs through realtime's
 * EVENT_PUBLISHER, asking its PRESENCE whether a tab is open (D-187).
 * Hears users' AccountDeletedEvent to delete that account's inbox (D-203).
 */
@Module({
    imports: [CqrsModule, PermissionsModule, RealtimeModule, ServersModule, UsersModule],
    controllers: [NotificationsController],
    providers: [
        { provide: NOTIFICATION_REPOSITORY, useClass: PrismaNotificationRepository },
        ...ITEM_COMMAND_HANDLERS,
        ...TASK_ITEM_COMMAND_HANDLERS,
        ...SERVER_ITEM_COMMAND_HANDLERS,
        ...READ_COMMAND_HANDLERS,
        CleanUpNotificationsHandler,
        ...INBOX_QUERY_HANDLERS,
        PublishCreatedNotificationsHandler,
        PublishReadNotificationsHandler,
        PublishDeletedNotificationsHandler,
        ForgetDeletedAccountItemsHandler
    ]
})
export class NotificationsModule {}

/**
 * This module's NOTIFIER port (D-185). Global, so messaging, tasks and
 * servers find it without importing this module, which reads messages
 * through messaging and members through servers: the Nest modules depend
 * one way only (D-198); servers and this module import each other's
 * index.ts, which loads no Nest module (D-185). The adapter only sends this
 * module's commands over the bus, so it needs nothing but CqrsModule.
 * AppModule imports it.
 */
@Global()
@Module({
    imports: [CqrsModule],
    providers: [{ provide: NOTIFIER, useClass: CommandBusNotifier }],
    exports: [NOTIFIER]
})
export class NotifierModule {}
