import { NewTask, TaskEventKind, TaskFacts, TaskStatus, TaskWrite } from '../task.rules'

/** A person a task names, as others may see them (D-182): no name or picture once deleted, or waiting to be. */
export interface TaskPerson {
    id: string
    username: string | null
    displayName: string | null
    /** The storage key of their picture; the application turns it into an address. */
    avatarKey: string | null
}

/** Someone on a task, and since when: the detail lists them in that order (S-TASK-02). */
export interface TaskAssignee {
    person: TaskPerson
    assignedAt: Date
}

/** A task as it is read for the board, its detail and `task.*`. */
export interface TaskRecord {
    id: string
    serverId: string
    channelId: string
    creator: TaskPerson
    title: string
    description: string
    status: TaskStatus
    dueAt: Date | null
    completedAt: Date | null
    createdAt: Date
    /** Moves on every write, a change of people included: the client keeps the latest copy it hears. */
    updatedAt: Date
    /** In the order they were given the task. */
    assignees: TaskAssignee[]
}

/** One line of a task's history (REQ-TASK-03). */
export interface TaskEventRecord {
    id: string
    kind: TaskEventKind
    /** Null when the app did it (an assignee who left the server, L4). */
    actor: TaskPerson | null
    /** The person added or taken off, for those two kinds. */
    subject: TaskPerson | null
    /** For a change of title, due date or status: what it was, and became (ISO times for dates). */
    from: string | null
    to: string | null
    createdAt: Date
}

/** Which tasks of a board: all, or those whose folded title holds these words (D-97). */
export interface TaskFilter {
    channelId: string
    /** Folded as titles are (foldForSearch); null: no search. */
    search: string | null
}

/**
 * Whose tasks the To-do page lists (REQ-TASK-05): those given to `userId`
 * and those they made and gave no one, in `channelIds` only (the channels
 * they view with the board on, worked out by the application, D-186).
 */
export interface MineFilter {
    userId: string
    channelIds: string[]
    /** Folded as titles are (foldForSearch); null: no search. */
    search: string | null
}

/** The tasks of the Task Boards (REQ-TASK-01 to 03): Task, TaskAssignee and TaskEvent. */
export interface TaskRepositoryPort {
    /**
     * Save a new task of the channel with its people and first history, after
     * `decide` passes on the channel's count of tasks not done, read under a
     * lock of that count: two at once cannot make a 501st. `decide` throws to
     * refuse. Null when the channel was deleted meanwhile.
     */
    create(
        place: { serverId: string; channelId: string; creatorId: string },
        task: NewTask,
        decide: (openCount: number) => void
    ): Promise<TaskRecord | null>

    /**
     * Change a task with the write `decide` makes of it, read under the
     * task's row lock, its history (done by `actorId`) in the same transaction. Null when there
     * is no such task (deleted meanwhile); `changed` false when `decide` wrote
     * nothing. `decide` throws to refuse.
     */
    change(
        taskId: string,
        actorId: string,
        decide: (task: TaskFacts) => TaskWrite | null
    ): Promise<{ record: TaskRecord; changed: boolean } | null>

    /** Delete a task with its people and history once `decide` passes on it; false when it was gone already. */
    remove(taskId: string, decide: (task: TaskFacts) => void): Promise<boolean>

    /** One task, or null. */
    find(taskId: string): Promise<TaskRecord | null>

    /** The board's tasks not done (at most 500), by due date, none last, then the order they were made in (S-TASK-01). */
    listOpen(filter: TaskFilter): Promise<TaskRecord[]>

    /** How many of the board's tasks are done: the "XONG — n" heading. */
    countDone(filter: TaskFilter): Promise<number>

    /**
     * A page of the board's done tasks, the latest done first (D-97), after
     * the task `beforeId` when given, one more than `limit` to say whether
     * there are more. `stale` when that task is not a done task of the
     * channel any more.
     */
    listDone(filter: TaskFilter, beforeId: string | null, limit: number): Promise<TaskRecord[] | 'stale'>

    /** The servers of the tasks the To-do page could list for `userId`, done or not: where to look. */
    serversOfMine(userId: string): Promise<string[]>

    /** Their tasks not done, by due date, none last, then the order they were made in (REQ-TASK-05). */
    listMineOpen(filter: MineFilter): Promise<TaskRecord[]>

    /** How many of their tasks are done: the "ĐÃ XONG — n" heading. */
    countMineDone(filter: MineFilter): Promise<number>

    /**
     * A page of their done tasks, the latest done first (D-97), after the
     * task `beforeId` when given, one more than `limit`. `stale` when that
     * task is not one of their done tasks any more.
     */
    listMineDone(filter: MineFilter, beforeId: string | null, limit: number): Promise<TaskRecord[] | 'stale'>

    /**
     * Take `userId` off every task of the server they are on (REQ-TASK-04,
     * D-195), each task's row locked, as `planLeftServer` writes it: a line
     * of history done by no one. The tasks as they now are.
     */
    unassignLeftMember(serverId: string, userId: string): Promise<TaskRecord[]>

    /** The newest `limit` lines of a task's history, newest first, and how many it has. */
    history(taskId: string, limit: number): Promise<{ items: TaskEventRecord[]; total: number }>
}

export const TASK_REPOSITORY = Symbol('TaskRepositoryPort')
