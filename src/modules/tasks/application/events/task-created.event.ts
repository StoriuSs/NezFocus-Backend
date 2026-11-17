import { TaskView } from '../services/task-views'

/** A task was made on a board (REQ-TASK-01), told to the channel as `task.created`. */
export class TaskCreatedEvent {
    constructor(readonly task: TaskView) {}
}
