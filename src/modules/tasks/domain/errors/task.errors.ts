import { DomainError } from '@/shared/domain/domain-error'

/** No such task, or it is in a channel the person may not view (NFR-SEC-05). */
export class TaskNotFoundError extends DomainError {
    readonly kind = 'not_found'
    readonly errorKey = 'NOT_FOUND'

    constructor(taskId: string) {
        super(`Task not found: ${taskId}`)
    }
}

/** The person views the task but this change is not theirs to make (REQ-TASK-02). */
export class CannotChangeTaskError extends DomainError {
    readonly kind = 'forbidden'
    readonly errorKey = 'FORBIDDEN'

    constructor() {
        super('You cannot make this change to the task')
    }
}

/** People who cannot view the task's channel cannot be put on it (REQ-TASK-01); `userIds` names them. */
export class InvalidTaskAssigneeError extends DomainError {
    readonly kind = 'invalid'
    readonly errorKey = 'INVALID_TASK_ASSIGNEE'
    readonly details: { userIds: string[] }

    constructor(userIds: string[]) {
        super(`Cannot be given the task: ${userIds.join(', ')}`)
        this.details = { userIds }
    }
}

/** A due date set or changed to a moment already passed (REQ-TASK-01, D-96). */
export class InvalidTaskDueDateError extends DomainError {
    readonly kind = 'invalid'
    readonly errorKey = 'INVALID_TASK_DUE_DATE'

    constructor() {
        super('The due date must be later than now')
    }
}

/** The channel has 500 tasks not done (REQ-TASK-01, SRS 7.2). */
export class MaxOpenTasksReachedError extends DomainError {
    readonly kind = 'conflict'
    readonly errorKey = 'MAX_OPEN_TASKS_REACHED'

    constructor(limit: number) {
        super(`A channel has at most ${limit} tasks not done`)
    }
}

/**
 * The task a page of done tasks starts after is no longer done, or gone
 * (SRS 5.1): the client loads the done group again from its start.
 */
export class StaleTaskCursorError extends DomainError {
    readonly kind = 'conflict'
    readonly errorKey = 'CONFLICT'

    constructor(taskId: string) {
        super(`Task ${taskId} is no longer done`)
    }
}
