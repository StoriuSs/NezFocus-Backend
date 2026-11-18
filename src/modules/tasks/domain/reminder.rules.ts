import type { TaskStatus } from './task.rules'

/*
 * Due-date reminders (REQ-TASK-04, D-95, ARCHITECTURE 7): 24 hours and 2
 * hours before a task is due, only the marks still ahead; each a job of the
 * tasks queue that reads the task again when it runs. Pure: the handlers
 * schedule and send what these decide.
 */

/** A reminder before the due date: the inbox and the channel say "Còn 24 giờ" or "Còn 2 giờ". */
export type ReminderMark = '24h' | '2h'

const HOUR_MS = 3600_000

/** The marks, the earliest first, and how long before the due date each falls. */
export const REMINDER_MARKS: readonly { mark: ReminderMark; beforeMs: number }[] = [
    { mark: '24h', beforeMs: 24 * HOUR_MS },
    { mark: '2h', beforeMs: 2 * HOUR_MS }
]

/** One reminder to send, and when. */
export interface ReminderAt {
    mark: ReminderMark
    at: Date
}

/**
 * The reminders of a due date still ahead of `now` (D-95): a task made or
 * moved past a mark gets only the marks left, as a mark already passed would
 * remind at the wrong moment. None without a due date.
 */
export function futureMarks(dueAt: Date | null, now: Date): ReminderAt[] {
    if (!dueAt) return []
    return REMINDER_MARKS.map(({ mark, beforeMs }) => ({ mark, at: new Date(dueAt.getTime() - beforeMs) })).filter(
        ({ at }) => at.getTime() > now.getTime()
    )
}

/** What of a task its reminders hang on. */
export interface Remindable {
    status: TaskStatus
    dueAt: Date | null
}

const isLive = (task: Remindable | null): task is Remindable & { dueAt: Date } =>
    task !== null && task.status !== 'done' && task.dueAt !== null

/**
 * The reminders a write asks for (ARCHITECTURE 7), from the task before it
 * (null: just made) and after it (null: deleted): those of the old due date
 * to drop and those of the new one to set. A due date moved drops one and
 * sets the other; done or deleted drops; reopened sets again. Nothing when
 * neither the due date nor being done changed.
 */
export function reminderChange(
    before: Remindable | null,
    after: Remindable | null
): { cancel: Date | null; schedule: Date | null } {
    const was = isLive(before) ? before.dueAt : null
    const is = isLive(after) ? after.dueAt : null
    if (was && is && was.getTime() === is.getTime()) return { cancel: null, schedule: null }
    return { cancel: was, schedule: is }
}

/**
 * Whether a reminder still holds when its job runs (ARCHITECTURE 7): the
 * task is there, not done, and due when the job was set for; and its moment
 * is not missed (D-95): a job run late, as after a restart, says nothing
 * once the next mark has come ("Còn 24 giờ" with 2 hours left), or the due
 * date. A job taken out just as the due date moved finds a different one
 * and does nothing.
 */
export function reminderHolds(task: Remindable | null, mark: ReminderMark, dueAt: Date, now: Date): boolean {
    if (!isLive(task) || task.dueAt.getTime() !== dueAt.getTime()) return false
    const later = REMINDER_MARKS.slice(REMINDER_MARKS.findIndex((one) => one.mark === mark) + 1)[0]
    const missedAt = dueAt.getTime() - (later?.beforeMs ?? 0)
    return now.getTime() < missedAt
}

/**
 * Who a reminder goes to (REQ-TASK-04): the people on the task who view its
 * channel now, in the order they were given it; with none of them, its
 * creator, if they view the channel. Someone on it who lost the channel
 * keeps the task (the "Mất quyền xem kênh" label) but hears nothing.
 */
export function reminderRecipients(assigneeIds: string[], creatorId: string, viewerIds: ReadonlySet<string>): string[] {
    const viewing = assigneeIds.filter((userId) => viewerIds.has(userId))
    if (viewing.length > 0) return viewing
    return viewerIds.has(creatorId) ? [creatorId] : []
}
