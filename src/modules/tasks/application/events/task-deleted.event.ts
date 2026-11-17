/** A task was deleted (REQ-TASK-02), told to the channel as `task.deleted`. */
export class TaskDeletedEvent {
    constructor(
        readonly taskId: string,
        readonly channelId: string
    ) {}
}
