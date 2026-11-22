/*
 * The periods of the Stats page (REQ-STUDY-07, D-104, D-105, D-230): a week
 * from Monday to Sunday or a calendar month, named by any day in it. Days are
 * the days of DailyStudy, YYYY-MM-DD; "today" is the day of the person's zone
 * when the page is read.
 */
import { localDateOf, LocalDate, nextDayStart } from './study-time.rules'

export type StudyView = 'week' | 'month'

/** A week or a month, its first and last day both in it. */
export interface Period {
    view: StudyView
    start: LocalDate
    end: LocalDate
}

/** The days of the 4-week grid: the 3 weeks before the one shown, and it (D-104). */
export const GRID_DAYS = 28

/** History lines a page (D-105). */
export const HISTORY_PAGE_SIZE = 20

const DAY_MS = 86_400_000

const asUtc = (date: LocalDate): number => Date.parse(`${date}T00:00:00.000Z`)
const fromUtc = (ms: number): LocalDate => new Date(ms).toISOString().slice(0, 10)

/** The day `days` after `date` (before it when negative). */
export const addDays = (date: LocalDate, days: number): LocalDate => fromUtc(asUtc(date) + days * DAY_MS)

/** How many days from `start` to `end`, both counted: 1 for one day, 0 when `end` comes first. */
export const dayCount = (start: LocalDate, end: LocalDate): number =>
    Math.max(0, Math.round((asUtc(end) - asUtc(start)) / DAY_MS) + 1)

/** The Monday of the week `date` is in. */
export function weekStartOf(date: LocalDate): LocalDate {
    const weekday = new Date(asUtc(date)).getUTCDay() // 0 is Sunday
    return addDays(date, -((weekday + 6) % 7))
}

/** The week or the month `date` is in. */
export function periodOf(view: StudyView, date: LocalDate): Period {
    if (view === 'week') {
        const start = weekStartOf(date)
        return { view, start, end: addDays(start, 6) }
    }
    const start = `${date.slice(0, 7)}-01`
    const day = new Date(asUtc(start))
    day.setUTCMonth(day.getUTCMonth() + 1)
    return { view, start, end: addDays(fromUtc(day.getTime()), -1) }
}

/** The period just before. */
export const previousPeriod = (period: Period): Period => periodOf(period.view, addDays(period.start, -1))

/** The days of a period gone by on `today`, today counted: all of a past one, none of one still ahead. */
export const elapsedDays = (period: Period, today: LocalDate): number =>
    today > period.end ? dayCount(period.start, period.end) : dayCount(period.start, today)

/**
 * The days of the period before that this one is compared with (spec 08):
 * as many first days as this one has gone by, so a Wednesday weighs Monday
 * to Wednesday of last week and 18/10 the 1st to the 18th of September; a
 * period gone by weighs all of the one before. Never past the end of the
 * period before (the 31st weighs all of a 30-day month). Null when none has
 * gone by: a period still ahead.
 */
export function comparedDays(period: Period, today: LocalDate): { start: LocalDate; end: LocalDate } | null {
    const before = previousPeriod(period)
    if (today > period.end) return { start: before.start, end: before.end }
    const days = Math.min(elapsedDays(period, today), dayCount(before.start, before.end))
    return days === 0 ? null : { start: before.start, end: addDays(before.start, days - 1) }
}

/** The mean a day over the days gone by, today counted, rounded down; 0 when none has (spec 08). */
export function averageSeconds(totalSeconds: number, period: Period, today: LocalDate): number {
    const days = elapsedDays(period, today)
    return days === 0 ? 0 : Math.floor(totalSeconds / days)
}

/** The days of the 4-week grid of a week shown: it ends on that week's Sunday (D-104). */
export const gridOf = (week: Period): { start: LocalDate; end: LocalDate } => ({
    start: addDays(week.end, 1 - GRID_DAYS),
    end: week.end
})

/**
 * Whether the week shown may be the best one (D-105, D-230): never the first
 * week with seconds, nor one before it, which would be the best of nothing.
 */
export const mayBeBestWeek = (week: Period, firstDate: LocalDate | null): boolean =>
    firstDate !== null && weekStartOf(firstDate) < week.start

/**
 * The first instant of `date` in the zone: its midnight, or 01:00 where
 * the clocks skip midnight. Starts two days before (on an earlier day in
 * every zone) and steps from day start to day start.
 */
export function dayStartIn(date: LocalDate, timeZone: string): Date {
    let at = new Date(asUtc(date) - 2 * DAY_MS)
    while (localDateOf(at, timeZone) < date) at = nextDayStart(at, timeZone)
    return at
}

/**
 * The instants of a period in the zone, `to` not included: a session belongs
 * to the period that holds its person's first join (D-229).
 */
export const instantsOf = (period: Period, timeZone: string): { from: Date; to: Date } => ({
    from: dayStartIn(period.start, timeZone),
    to: dayStartIn(addDays(period.end, 1), timeZone)
})
