import { Remindable } from '../../domain'
import { TaskView } from '../services/task-views'

/**
 * What one write did to a task, for those who act on it after the commit:
 * the inbox (D-98, D-95) and the reminders (REQ-TASK-04).
 */
export interface TaskChange {
    /** Who did it; null when the app did (a member who left the server, D-195). */
    actorId: string | null
    /** People put on it, in order. */
    added: string[]
    /** People taken off it. */
    removed: string[]
    /** Its due date and status before the write. */
    before: Remindable
}

/**
 * A task changed: its words, due date, status or people (REQ-TASK-01, 02),
 * told to the channel as `task.updated` with the task as it now is, and what
 * the write did. Not published when nothing changed.
 */
export class TaskUpdatedEvent {
    constructor(
        readonly task: TaskView,
        readonly change: TaskChange
    ) {}
}
