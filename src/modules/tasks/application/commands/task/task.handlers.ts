import { Inject } from '@nestjs/common'
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { CHANNEL_DIRECTORY, ChannelDirectoryPort } from '@/modules/servers'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import {
    ChannelNotFoundError,
    planCreate,
    planEdit,
    requireDelete,
    requireOpenRoom,
    TASK_REPOSITORY,
    TaskRepositoryPort
} from '../../../domain'
import { TaskCreatedEvent } from '../../events/task-created.event'
import { openBoard, viewersOf } from '../../services/board-access'
import { ChangeTask } from '../../services/change-task'
import { TaskView, taskView } from '../../services/task-views'
import { CreateTaskCommand, DeleteTaskCommand, UpdateTaskCommand } from './task.commands'

/**
 * A new task on a board that is on (REQ-TASK-01, 02): CREATE_TASKS, not
 * timed out, a due date still ahead, people who view the channel, and room
 * under the channel's 500 tasks not done, counted under a lock. It returns
 * the task it tells the channel (D-191).
 */
@CommandHandler(CreateTaskCommand)
export class CreateTaskHandler implements ICommandHandler<CreateTaskCommand> {
    constructor(
        @Inject(TASK_REPOSITORY) private readonly tasks: TaskRepositoryPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly checker: PermissionCheckerPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort,
        private readonly events: EventBus
    ) {}

    async execute({ userId, channelId, draft }: CreateTaskCommand): Promise<TaskView> {
        const now = new Date()
        const board = await openBoard({ channels: this.channels, checker: this.checker }, channelId, userId, now)
        const viewers = await viewersOf(this.checker, board, draft.assigneeIds, now)
        const task = planCreate(board.actor, draft, viewers, now)

        const record = await this.tasks.create(
            { serverId: board.serverId, channelId, creatorId: userId },
            task,
            requireOpenRoom
        )
        // The channel went between opening it and now.
        if (!record) throw new ChannelNotFoundError(channelId)
        const view = await taskView(this.users, record)
        this.events.publish(new TaskCreatedEvent(view))
        return view
    }
}

/**
 * "Sửa việc" and the status control (REQ-TASK-01 to 03, D-96): each field
 * that really changes needs its right, a new due date must be ahead, and
 * done stamps the time.
 */
@CommandHandler(UpdateTaskCommand)
export class UpdateTaskHandler extends ChangeTask implements ICommandHandler<UpdateTaskCommand> {
    async execute({ userId, taskId, edit }: UpdateTaskCommand): Promise<TaskView> {
        const now = new Date()
        const { actor } = await this.open(taskId, userId, now)
        return this.apply(taskId, userId, (task) => planEdit(task, actor, edit, now))
    }
}

/** Gone for everyone with its people, history and inbox items (REQ-TASK-02, D-98): the creator or MANAGE_TASKS. */
@CommandHandler(DeleteTaskCommand)
export class DeleteTaskHandler extends ChangeTask implements ICommandHandler<DeleteTaskCommand> {
    async execute({ userId, taskId }: DeleteTaskCommand): Promise<void> {
        const board = await this.open(taskId, userId, new Date())
        await this.delete(taskId, board, (task) => requireDelete(task, board.actor))
    }
}

export const TASK_COMMAND_HANDLERS = [CreateTaskHandler, UpdateTaskHandler, DeleteTaskHandler]
