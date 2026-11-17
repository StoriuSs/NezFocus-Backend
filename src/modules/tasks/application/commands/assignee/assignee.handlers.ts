import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { planAssign, planUnassign } from '../../../domain'
import { viewersOf } from '../../services/board-access'
import { ChangeTask } from '../../services/change-task'
import { TaskView } from '../../services/task-views'
import { AssignTaskCommand, UnassignTaskCommand } from './assignee.commands'

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

export const ASSIGNEE_COMMAND_HANDLERS = [AssignTaskHandler, UnassignTaskHandler]
