/*
 * The groups of the To-do page (REQ-TASK-05, S-TASK-04, D-186): a task not
 * done falls in one by its due date, counted in calendar days of the
 * reader's time zone (AUTH-08), never the server's.
 */

/** Quá hạn, Hôm nay, 7 ngày tới (tomorrow to today + 6), Sau đó, Không hạn. */
export const DUE_GROUPS = ['overdue', 'today', 'next_7_days', 'later', 'no_due'] as const
export type DueGroup = (typeof DUE_GROUPS)[number]

/** The zone a reader without one set is counted in. */
export const FALLBACK_TIME_ZONE = 'UTC'

const DAY_MS = 86_400_000

/** One calendar per zone, made once: a list reads two days for each task. */
const calendars = new Map<string, Intl.DateTimeFormat>()
const calendarOf = (timeZone: string): Intl.DateTimeFormat => {
    let calendar = calendars.get(timeZone)
    if (!calendar) {
        calendar = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' })
        calendars.set(timeZone, calendar)
    }
    return calendar
}

/** The calendar day an instant falls on in a zone, as days since 1970-01-01. */
function dayOf(at: Date, timeZone: string): number {
    const parts = calendarOf(timeZone).formatToParts(at)
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((one) => one.type === type)!.value)
    return Date.UTC(part('year'), part('month') - 1, part('day')) / DAY_MS
}

/**
 * The group of a task not done due at `dueAt`, read at `now` in `timeZone`.
 * Past its due time it is overdue, even later the same day ("Quá hạn · Hôm
 * nay · 21:00"); otherwise it goes by how many days away its due day is.
 */
export function dueGroupOf(dueAt: Date | null, now: Date, timeZone: string): DueGroup {
    if (dueAt === null) return 'no_due'
    if (dueAt.getTime() <= now.getTime()) return 'overdue'
    const days = dayOf(dueAt, timeZone) - dayOf(now, timeZone)
    if (days <= 0) return 'today'
    return days <= 6 ? 'next_7_days' : 'later'
}

/** The rail's "Việc" badge counts these two groups (spec 05, C-05). */
export const isDueSoon = (group: DueGroup): boolean => group === 'overdue' || group === 'today'
