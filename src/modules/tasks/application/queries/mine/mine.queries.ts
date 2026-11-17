/*
 * The To-do page (REQ-TASK-05, S-TASK-04): one's tasks from every server,
 * or one server's (`serverId`); `search`: only those whose title holds it
 * (D-97). Only tasks of channels one still views with the board on.
 */

/** One's tasks not done, each with its group by due date, and the counts of the page and the rail (D-186). */
export class ListMyTasksQuery {
    constructor(
        public readonly userId: string,
        public readonly serverId: string | null,
        public readonly search: string | null
    ) {}
}

/** A page of one's done tasks, the latest done first, after the task `beforeId` (D-97). */
export class ListMyDoneTasksQuery {
    constructor(
        public readonly userId: string,
        public readonly serverId: string | null,
        public readonly search: string | null,
        public readonly beforeId: string | null
    ) {}
}
