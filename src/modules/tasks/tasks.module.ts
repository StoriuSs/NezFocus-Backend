import { Module } from '@nestjs/common'
import { CqrsModule } from '@nestjs/cqrs'
import { PermissionsModule } from '@/modules/permissions/permissions.module'
import { RealtimeModule } from '@/modules/realtime/realtime.module'
import { ServersModule } from '@/modules/servers/servers.module'
import { UsersModule } from '@/modules/users/users.module'
import { TASK_REPOSITORY } from './domain'
import {
    ASSIGNEE_COMMAND_HANDLERS,
    PublishCreatedTaskHandler,
    PublishDeletedTaskHandler,
    PublishUpdatedTaskHandler,
    TASK_COMMAND_HANDLERS,
    TASK_QUERY_HANDLERS
} from './application'
import { PrismaTaskRepository } from './infrastructure'
import { BoardController, TasksController } from './presentation'

/**
 * The Task Boards of text channels (SRS 4.7): the only module that writes
 * Task, TaskAssignee and TaskEvent. Asks servers which server a channel is
 * in (CHANNEL_DIRECTORY), permissions what someone may do there and whether
 * the board is on (PERMISSION_CHECKER, D-189), users for pictures as
 * addresses (USER_DIRECTORY), and tells the channel's sockets through
 * realtime's EVENT_PUBLISHER.
 */
@Module({
    imports: [CqrsModule, PermissionsModule, RealtimeModule, ServersModule, UsersModule],
    controllers: [BoardController, TasksController],
    providers: [
        { provide: TASK_REPOSITORY, useClass: PrismaTaskRepository },
        ...TASK_COMMAND_HANDLERS,
        ...ASSIGNEE_COMMAND_HANDLERS,
        ...TASK_QUERY_HANDLERS,
        PublishCreatedTaskHandler,
        PublishUpdatedTaskHandler,
        PublishDeletedTaskHandler
    ]
})
export class TasksModule {}
