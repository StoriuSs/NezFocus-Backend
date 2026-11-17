import { Inject } from '@nestjs/common'
import { EventBus } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { CHANNEL_DIRECTORY, ChannelDirectoryPort } from '@/modules/servers'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { TASK_REPOSITORY, TaskFacts, TaskNotFoundError, TaskRepositoryPort, TaskWrite } from '../../domain'
import { TaskDeletedEvent } from '../events/task-deleted.event'
import { TaskUpdatedEvent } from '../events/task-updated.event'
import { BoardSources, OpenBoard, openTask } from './board-access'
import { TaskView, taskView } from './task-views'

/**
 * What every change to an existing task does around its own rule (D-157,
 * D-190): open the task as the person sees it (not found, board off), then
 * let the rule decide on the task as it is under its lock, write it with its
 * history, and tell the channel after the commit. A write that changes
 * nothing tells no one. The command answers with the task it told (D-191).
 */
export abstract class ChangeTask {
    constructor(
        @Inject(TASK_REPOSITORY) protected readonly tasks: TaskRepositoryPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) protected readonly checker: PermissionCheckerPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort,
        private readonly events: EventBus
    ) {}

    private get sources(): BoardSources {
        return { channels: this.channels, checker: this.checker }
    }

    /** The task's board as `userId` sees it now. */
    protected async open(taskId: string, userId: string, now: Date): Promise<OpenBoard> {
        return (await openTask(this.tasks, this.sources, taskId, userId, now)).board
    }

    /** Write what `decide` makes of the locked task, then tell the channel if anything changed. */
    protected async apply(
        taskId: string,
        userId: string,
        decide: (task: TaskFacts) => TaskWrite | null
    ): Promise<TaskView> {
        const result = await this.tasks.change(taskId, userId, decide)
        // Deleted between opening it and now.
        if (!result) throw new TaskNotFoundError(taskId)
        const view = await taskView({ users: this.users, checker: this.checker }, result.record)
        if (result.changed) this.events.publish(new TaskUpdatedEvent(view))
        return view
    }

    /** Delete the task once `decide` passes on it, then tell the channel. */
    protected async delete(taskId: string, board: OpenBoard, decide: (task: TaskFacts) => void): Promise<void> {
        if (!(await this.tasks.remove(taskId, decide))) throw new TaskNotFoundError(taskId)
        this.events.publish(new TaskDeletedEvent(taskId, board.channelId))
    }
}
