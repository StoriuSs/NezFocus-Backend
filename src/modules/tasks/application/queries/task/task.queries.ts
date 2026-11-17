/*
 * Reading Task Boards (REQ-TASK-01 to 03, S-TASK-01, S-TASK-02): the tasks
 * not done, the done ones a page at a time, one task, its history. A
 * channel or task one may not view is not found (NFR-SEC-05); a board that
 * is off says so.
 */

/** The board's tasks not done, and how many are done; `search`: only those whose title holds it (D-97). */
export class ListBoardTasksQuery {
    constructor(
        public readonly userId: string,
        public readonly channelId: string,
        public readonly search: string | null
    ) {}
}

/** A page of the board's done tasks, the latest done first, after the task `beforeId` (D-97). */
export class ListDoneTasksQuery {
    constructor(
        public readonly userId: string,
        public readonly channelId: string,
        public readonly search: string | null,
        public readonly beforeId: string | null
    ) {}
}

/** One task: a link to it, an inbox item, a reminder (S-TASK-02). */
export class GetTaskQuery {
    constructor(
        public readonly userId: string,
        public readonly taskId: string
    ) {}
}

/** A task's history, newest first (REQ-TASK-03). */
export class ListTaskHistoryQuery {
    constructor(
        public readonly userId: string,
        public readonly taskId: string
    ) {}
}
