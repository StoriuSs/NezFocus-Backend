import { Global, Module } from '@nestjs/common'
import { CqrsModule } from '@nestjs/cqrs'
import { PermissionsModule } from '@/modules/permissions/permissions.module'
import { RealtimeModule } from '@/modules/realtime/realtime.module'
import { ServersModule } from '@/modules/servers/servers.module'
import { UsersModule } from '@/modules/users/users.module'
import { NOTIFICATION_REPOSITORY } from './domain'
import {
    CleanUpNotificationsHandler,
    INBOX_QUERY_HANDLERS,
    ITEM_COMMAND_HANDLERS,
    NOTIFIER,
    PublishCreatedNotificationsHandler,
    PublishDeletedNotificationsHandler,
    PublishReadNotificationsHandler,
    READ_COMMAND_HANDLERS,
    TASK_ITEM_COMMAND_HANDLERS
} from './application'
import { CommandBusNotifier, PrismaNotificationRepository } from './infrastructure'
import { NotificationsController } from './presentation'

/**
 * The inbox (SRS 4.8): the only module that writes Notification. Other
 * modules put items in through NOTIFIER (D-185): messaging for mentions and
 * replies, tasks for task items (D-98); the messages items are
 * about it reads through MESSAGE_PREVIEWS, answered by messaging (D-198).
 * Asks servers which servers someone is in (MEMBERSHIP), permissions which
 * channels they view (PERMISSION_CHECKER), users for pictures as addresses
 * (USER_DIRECTORY), and tells each person's tabs through realtime's
 * EVENT_PUBLISHER.
 */
@Module({
    imports: [CqrsModule, PermissionsModule, RealtimeModule, ServersModule, UsersModule],
    controllers: [NotificationsController],
    providers: [
        { provide: NOTIFICATION_REPOSITORY, useClass: PrismaNotificationRepository },
        ...ITEM_COMMAND_HANDLERS,
        ...TASK_ITEM_COMMAND_HANDLERS,
        ...READ_COMMAND_HANDLERS,
        CleanUpNotificationsHandler,
        ...INBOX_QUERY_HANDLERS,
        PublishCreatedNotificationsHandler,
        PublishReadNotificationsHandler,
        PublishDeletedNotificationsHandler
    ]
})
export class NotificationsModule {}

/**
 * This module's NOTIFIER port (D-185). Global, so messaging and tasks
 * (servers later) find it without importing this module, which reads
 * messages through messaging: the code depends one way only (D-198). The
 * adapter only sends this module's commands over the bus, so it needs
 * nothing but CqrsModule. AppModule imports it.
 */
@Global()
@Module({
    imports: [CqrsModule],
    providers: [{ provide: NOTIFIER, useClass: CommandBusNotifier }],
    exports: [NOTIFIER]
})
export class NotifierModule {}
