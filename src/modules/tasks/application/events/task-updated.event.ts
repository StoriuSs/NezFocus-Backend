import { TaskView } from '../services/task-views'

/**
 * A task changed: its words, due date, status or people (REQ-TASK-01, 02),
 * told to the channel as `task.updated` with the task as it now is. Not
 * published when nothing changed.
 */
export class TaskUpdatedEvent {
    constructor(readonly task: TaskView) {}
}
