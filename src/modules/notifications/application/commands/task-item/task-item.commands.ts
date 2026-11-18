import { TaskItemDraft } from '../../../domain'

/*
 * The items of tasks (D-95, D-98, REQ-TASK-04): written for the people the
 * tasks module names after its own write, through NOTIFIER; and, once a task
 * is deleted with its items, telling those who may have had one (D-200).
 */

/** Give these people the same task item: given the task, reminded of it, or told no one is on it any more. */
export class AddTaskItemsCommand {
    constructor(
        readonly draft: TaskItemDraft,
        readonly userIds: string[]
    ) {}
}

/** A task deleted, its items gone with it: tell these people, with their unread count (D-200). */
export class ForgetTaskItemsCommand {
    constructor(
        readonly taskId: string,
        readonly userIds: string[]
    ) {}
}
