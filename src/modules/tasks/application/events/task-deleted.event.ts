import { Remindable } from '../../domain'

/**
 * A task was deleted (REQ-TASK-02), told to the channel as `task.deleted`.
 * `before`: its due date and status, whose reminders go; `peopleIds`: its
 * creator and all ever put on it, who may have had an item of it (D-200).
 */
export class TaskDeletedEvent {
    constructor(
        readonly taskId: string,
        readonly channelId: string,
        readonly before: Remindable,
        readonly peopleIds: string[]
    ) {}
}
