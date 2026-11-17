import { Module } from '@nestjs/common'
import { CqrsModule } from '@nestjs/cqrs'
import { PermissionsModule } from '@/modules/permissions/permissions.module'
import { RealtimeModule } from '@/modules/realtime/realtime.module'
import { ServersModule } from '@/modules/servers/servers.module'
import { UsersModule } from '@/modules/users/users.module'
import { QUEUES, registerQueues } from '@/shared/infrastructure/queue/queues'
import { TASK_REPOSITORY } from './domain'
import {
    ASSIGNEE_COMMAND_HANDLERS,
    PublishCreatedTaskHandler,
    PublishDeletedTaskHandler,
    PublishUpdatedTaskHandler,
    TASK_COMMAND_HANDLERS,
    TASK_JOBS,
    TASK_QUERY_HANDLERS,
    UnassignLeftMemberLaterHandler
} from './application'
import { BullMqTaskJobs, PrismaTaskRepository } from './infrastructure'
import { BoardController, TasksController, TasksJobsConsumer } from './presentation'

/**
 * The Task Boards of text channels (SRS 4.7): the only module that writes
 * Task, TaskAssignee and TaskEvent. Asks servers which server a channel is
 * in (CHANNEL_DIRECTORY) and whether someone is still a member (MEMBERSHIP),
 * permissions what someone may do there and whether
 * the board is on (PERMISSION_CHECKER, D-189), users for pictures as
 * addresses (USER_DIRECTORY), and tells the channel's sockets through
 * realtime's EVENT_PUBLISHER. Its own `tasks` queue takes members who left a
 * server off its tasks (D-195).
 */
@Module({
    imports: [CqrsModule, PermissionsModule, RealtimeModule, ServersModule, UsersModule, registerQueues(QUEUES.TASKS)],
    controllers: [BoardController, TasksController],
    providers: [
        { provide: TASK_REPOSITORY, useClass: PrismaTaskRepository },
        { provide: TASK_JOBS, useClass: BullMqTaskJobs },
        ...TASK_COMMAND_HANDLERS,
        ...ASSIGNEE_COMMAND_HANDLERS,
        ...TASK_QUERY_HANDLERS,
        PublishCreatedTaskHandler,
        PublishUpdatedTaskHandler,
        PublishDeletedTaskHandler,
        UnassignLeftMemberLaterHandler,
        TasksJobsConsumer
    ]
})
export class TasksModule {}
