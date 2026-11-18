import { Inject } from '@nestjs/common'
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { MEMBERSHIP, MembershipPort } from '@/modules/servers'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { planAssign, planUnassign, TASK_REPOSITORY, TaskRepositoryPort } from '../../../domain'
import { TaskUpdatedEvent } from '../../events/task-updated.event'
import { viewersOf } from '../../services/board-access'
import { ChangeTask } from '../../services/change-task'
import { TaskView, taskViews } from '../../services/task-views'
import { AssignTaskCommand, UnassignLeftMemberCommand, UnassignTaskCommand } from './assignee.commands'

/**
 * People added to a task (REQ-TASK-02): oneself by anyone who views the
 * channel, others by the creator, anyone on it or MANAGE_TASKS; each must
 * view the channel now. People already on it are skipped.
 */
@CommandHandler(AssignTaskCommand)
export class AssignTaskHandler extends ChangeTask implements ICommandHandler<AssignTaskCommand> {
    async execute({ userId, taskId, assigneeIds }: AssignTaskCommand): Promise<TaskView> {
        const now = new Date()
        const board = await this.open(taskId, userId, now)
        const viewers = await viewersOf(this.checker, board, assigneeIds, now)
        return this.apply(taskId, userId, (task) => planAssign(task, board.actor, assigneeIds, viewers))
    }
}

/**
 * Someone taken off a task (REQ-TASK-02): oneself, or another by the
 * creator or MANAGE_TASKS. Someone not on it changes nothing.
 */
@CommandHandler(UnassignTaskCommand)
export class UnassignTaskHandler extends ChangeTask implements ICommandHandler<UnassignTaskCommand> {
    async execute({ userId, taskId, assigneeId }: UnassignTaskCommand): Promise<TaskView> {
        const { actor } = await this.open(taskId, userId, new Date())
        return this.apply(taskId, userId, (task) => planUnassign(task, actor, assigneeId))
    }
}

/**
 * A member who left the server, by themselves, kicked, banned or as a
 * deleted account, taken off its tasks (REQ-TASK-04, D-195), each task told
 * to its channel. One who joined again before the job ran keeps them: asked
 * of the servers module's table (MEMBERSHIP), not the permission cache, which
 * a failed clear could leave holding them, the job then ending with nothing
 * done for good. One joining again between that read and the write still
 * comes off (the same as leaving a moment later). The creator of a task
 * left with no one on it hears of it (D-95, NotifyTaskPeopleHandler).
 *
 * @returns how many tasks they were taken off
 */
@CommandHandler(UnassignLeftMemberCommand)
export class UnassignLeftMemberHandler implements ICommandHandler<UnassignLeftMemberCommand> {
    constructor(
        @Inject(TASK_REPOSITORY) private readonly tasks: TaskRepositoryPort,
        @Inject(MEMBERSHIP) private readonly membership: MembershipPort,
        @Inject(PERMISSION_CHECKER) private readonly checker: PermissionCheckerPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort,
        private readonly events: EventBus
    ) {}

    async execute({ serverId, userId }: UnassignLeftMemberCommand): Promise<number> {
        if ((await this.membership.membersAmong(serverId, [userId])).length > 0) return 0
        const records = await this.tasks.unassignLeftMember(serverId, userId)
        const views = await taskViews({ users: this.users, checker: this.checker }, records)
        for (const view of views) {
            // Nobody acted: the inbox says "{Tên} đã rời server" to a creator left with no one on it (D-95).
            this.events.publish(
                new TaskUpdatedEvent(view, {
                    actorId: null,
                    added: [],
                    removed: [userId],
                    before: { status: view.status, dueAt: view.dueAt }
                })
            )
        }
        return views.length
    }
}

export const ASSIGNEE_COMMAND_HANDLERS = [AssignTaskHandler, UnassignTaskHandler, UnassignLeftMemberHandler]
