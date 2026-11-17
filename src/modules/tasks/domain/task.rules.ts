import {
    CannotChangeTaskError,
    InvalidTaskAssigneeError,
    InvalidTaskDueDateError,
    MaxOpenTasksReachedError,
    TaskTimedOutError
} from './errors'
import { foldForSearch } from './task-text.rules'

/*
 * What may be done to a task, by whom, and what it writes (REQ-TASK-01 to 03,
 * spec 05 › Ma trận vai trò). Pure: the repository reads the task under a
 * lock and calls these on what it read (ARCHITECTURE 2.3).
 */

/** Free to move either way (SRS 7.2). */
export type TaskStatus = 'todo' | 'doing' | 'done'

export const TASK_STATUSES: readonly TaskStatus[] = ['todo', 'doing', 'done']

/** Tasks not done in one channel (REQ-TASK-01, SRS 7.2). */
export const MAX_OPEN_TASKS = 500

/** Done tasks a page, newest done first (D-97). */
export const DONE_PAGE_SIZE = 50

/** The newest lines of a task's history one read gives (REQ-TASK-03). */
export const HISTORY_PAGE_SIZE = 200

/** Who acts on a task, as their permissions in its channel say. */
export interface TaskActor {
    userId: string
    /** MANAGE_TASKS in the channel. */
    manages: boolean
    /** CREATE_TASKS in the channel. */
    creates: boolean
    /** The end of their timeout, while it holds them back; null otherwise (the owner and ADMINISTRATOR never). */
    timedOutUntil: Date | null
}

/** A task as stored, read under its lock: what the rules decide on. */
export interface TaskFacts {
    id: string
    channelId: string
    creatorId: string
    title: string
    description: string
    status: TaskStatus
    dueAt: Date | null
    /** In the order they were given the task. */
    assigneeIds: string[]
    /**
     * For a done task, the channel's tasks not done, counted under the lock
     * that guards the limit: reopening it adds one (spec 05 › Edge case).
     * Null for a task not done, whose changes never add one.
     */
    openCount: number | null
}

/** One line of a task's history as it is written (REQ-TASK-03); `data` is stored as it is. */
export type TaskEventDraft =
    | { kind: 'created'; data: Record<string, never> }
    | { kind: 'title_changed'; data: { from: string; to: string } }
    | { kind: 'description_changed'; data: Record<string, never> }
    | { kind: 'due_changed'; data: { from: string | null; to: string | null } }
    | { kind: 'assignee_added'; data: { userId: string } }
    | { kind: 'assignee_removed'; data: { userId: string } }
    | { kind: 'status_changed'; data: { from: TaskStatus; to: TaskStatus } }

export type TaskEventKind = TaskEventDraft['kind']

export const TASK_EVENT_KINDS: readonly TaskEventKind[] = [
    'created',
    'title_changed',
    'description_changed',
    'due_changed',
    'assignee_added',
    'assignee_removed',
    'status_changed'
]

/** A task to make, as the request has it (title and description already normalised). */
export interface TaskDraft {
    title: string
    description: string
    dueAt: Date | null
    assigneeIds: string[]
}

/** A task to save: the draft with its search key, its people once each, and its first history. */
export interface NewTask {
    title: string
    titleSearch: string
    description: string
    dueAt: Date | null
    assigneeIds: string[]
    events: TaskEventDraft[]
}

/** The columns of a task a change writes; what is left out stays. */
export interface TaskChanges {
    title?: string
    titleSearch?: string
    description?: string
    dueAt?: Date | null
    status?: TaskStatus
    /** Set when it becomes done, emptied when it is reopened. */
    completedAt?: Date | null
}

/** One change to a task, written in one transaction with its history. */
export interface TaskWrite {
    changes: TaskChanges
    addAssigneeIds: string[]
    removeAssigneeIds: string[]
    events: TaskEventDraft[]
}

/** What "Sửa việc" and the status control send (S-TASK-02, S-TASK-03); anything left out stays. */
export interface TaskEdit {
    title?: string
    description?: string
    /** Null: no due date. */
    dueAt?: Date | null
    status?: TaskStatus
}

// --- Who may ---------------------------------------------------------------

/** Nothing changes for someone timed out, whoever made the task (D-188). */
function requireActive(actor: TaskActor): void {
    if (actor.timedOutUntil) throw new TaskTimedOutError(actor.timedOutUntil)
}

const isCreator = (task: TaskFacts, actor: TaskActor) => task.creatorId === actor.userId
const isAssignee = (task: TaskFacts, actor: TaskActor) => task.assigneeIds.includes(actor.userId)

/** Title, description, due date, deleting it: the creator or MANAGE_TASKS. */
const mayEdit = (task: TaskFacts, actor: TaskActor) => isCreator(task, actor) || actor.manages

/** Its status, and adding others to it: the creator, anyone on it, or MANAGE_TASKS. */
const mayWorkOn = (task: TaskFacts, actor: TaskActor) => mayEdit(task, actor) || isAssignee(task, actor)

/** A due date set or changed must be later than now; an old one kept is never checked (D-96). */
function requireFuture(dueAt: Date | null, now: Date): void {
    if (dueAt && dueAt.getTime() <= now.getTime()) throw new InvalidTaskDueDateError()
}

/** Everyone put on a task must view its channel at that moment (REQ-TASK-01). */
function requireViewers(userIds: string[], viewerIds: ReadonlySet<string>): void {
    const blind = userIds.filter((userId) => !viewerIds.has(userId))
    if (blind.length > 0) throw new InvalidTaskAssigneeError(blind)
}

const once = (ids: string[]) => [...new Set(ids)]

const iso = (at: Date | null) => at?.toISOString() ?? null

const sameTime = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null)

// --- Making and deleting -----------------------------------------------------

/**
 * A new task (REQ-TASK-01, 02): CREATE_TASKS, a due date still ahead, and
 * people who view the channel. Its history starts in the order the detail
 * shows it read upwards: made, its due date, then each person.
 */
export function planCreate(actor: TaskActor, draft: TaskDraft, viewerIds: ReadonlySet<string>, now: Date): NewTask {
    requireActive(actor)
    if (!actor.creates) throw new CannotChangeTaskError()
    requireFuture(draft.dueAt, now)
    const assigneeIds = once(draft.assigneeIds)
    requireViewers(assigneeIds, viewerIds)

    const events: TaskEventDraft[] = [{ kind: 'created', data: {} }]
    if (draft.dueAt) events.push({ kind: 'due_changed', data: { from: null, to: iso(draft.dueAt) } })
    for (const userId of assigneeIds) events.push({ kind: 'assignee_added', data: { userId } })
    return {
        title: draft.title,
        titleSearch: foldForSearch(draft.title),
        description: draft.description,
        dueAt: draft.dueAt,
        assigneeIds,
        events
    }
}

/** Room for one more open task in the channel, counted under the channel's lock (REQ-TASK-01). */
export function requireOpenRoom(openCount: number): void {
    if (openCount >= MAX_OPEN_TASKS) throw new MaxOpenTasksReachedError(MAX_OPEN_TASKS)
}

/** Deleting a task: the creator or MANAGE_TASKS (REQ-TASK-02). */
export function requireDelete(task: TaskFacts, actor: TaskActor): void {
    requireActive(actor)
    if (!mayEdit(task, actor)) throw new CannotChangeTaskError()
}

// --- Changing ----------------------------------------------------------------

/**
 * A change from "Sửa việc" or the status control (REQ-TASK-01 to 03). Only
 * what really changes is checked and written, so a field sent back as it is
 * needs no right and a date kept as it was is never "in the past" (D-96).
 * Null when nothing changes: nothing is written and nobody is told.
 */
export function planEdit(task: TaskFacts, actor: TaskActor, edit: TaskEdit, now: Date): TaskWrite | null {
    requireActive(actor)
    const changes: TaskChanges = {}
    const events: TaskEventDraft[] = []

    if (edit.title !== undefined && edit.title !== task.title) {
        changes.title = edit.title
        changes.titleSearch = foldForSearch(edit.title)
        events.push({ kind: 'title_changed', data: { from: task.title, to: edit.title } })
    }
    if (edit.description !== undefined && edit.description !== task.description) {
        changes.description = edit.description
        events.push({ kind: 'description_changed', data: {} })
    }
    if (edit.dueAt !== undefined && !sameTime(edit.dueAt, task.dueAt)) {
        requireFuture(edit.dueAt, now)
        changes.dueAt = edit.dueAt
        events.push({ kind: 'due_changed', data: { from: iso(task.dueAt), to: iso(edit.dueAt) } })
    }
    if (events.length > 0 && !mayEdit(task, actor)) throw new CannotChangeTaskError()

    if (edit.status !== undefined && edit.status !== task.status) {
        if (!mayWorkOn(task, actor)) throw new CannotChangeTaskError()
        if (task.status === 'done') requireOpenRoom(task.openCount ?? 0)
        changes.status = edit.status
        if (edit.status === 'done') changes.completedAt = now
        else if (task.status === 'done') changes.completedAt = null
        events.push({ kind: 'status_changed', data: { from: task.status, to: edit.status } })
    }

    return events.length === 0 ? null : { changes, addAssigneeIds: [], removeAssigneeIds: [], events }
}

/**
 * People added to a task ("Thêm người", "Tôi làm"; REQ-TASK-02). Anyone who
 * views the channel may take it on themselves; adding someone else is for
 * the creator, anyone on it and MANAGE_TASKS. Each must view the channel.
 * People already on it are skipped; null when nobody is new.
 */
export function planAssign(
    task: TaskFacts,
    actor: TaskActor,
    userIds: string[],
    viewerIds: ReadonlySet<string>
): TaskWrite | null {
    requireActive(actor)
    const added = once(userIds).filter((userId) => !task.assigneeIds.includes(userId))
    if (added.some((userId) => userId !== actor.userId) && !mayWorkOn(task, actor)) throw new CannotChangeTaskError()
    requireViewers(added, viewerIds)
    if (added.length === 0) return null
    return {
        changes: {},
        addAssigneeIds: added,
        removeAssigneeIds: [],
        events: added.map((userId) => ({ kind: 'assignee_added', data: { userId } }))
    }
}

/**
 * Someone taken off a task (REQ-TASK-02): themselves ("Rút khỏi việc này"),
 * or another by the creator or MANAGE_TASKS. Null when they were not on it.
 * The last one leaving makes it "Chưa giao"; telling its creator comes with
 * the inbox (D-95, L7).
 */
export function planUnassign(task: TaskFacts, actor: TaskActor, userId: string): TaskWrite | null {
    requireActive(actor)
    if (userId !== actor.userId && !mayEdit(task, actor)) throw new CannotChangeTaskError()
    if (!task.assigneeIds.includes(userId)) return null
    return {
        changes: {},
        addAssigneeIds: [],
        removeAssigneeIds: [userId],
        events: [{ kind: 'assignee_removed', data: { userId } }]
    }
}

/**
 * Someone who left the server, off a task they are on (REQ-TASK-04, D-195):
 * no one did it, so its line of history has no actor ("{Tên} rời server nên
 * không còn được giao"). The last one leaving makes it "Chưa giao"; telling
 * its creator comes with the inbox (D-95, L7).
 */
export function planLeftServer(userId: string): TaskWrite {
    return {
        changes: {},
        addAssigneeIds: [],
        removeAssigneeIds: [userId],
        events: [{ kind: 'assignee_removed', data: { userId } }]
    }
}
