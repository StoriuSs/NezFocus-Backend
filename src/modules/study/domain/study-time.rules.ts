/*
 * The seconds a person studied (REQ-STUDY-04, ARCHITECTURE 5.2): the overlap
 * of their time in a session (Participation) with the stretches its focus
 * phase ran (FocusStretch, D-216), split by the days of their time zone, with
 * at most 16 hours a day (D-222). A count (chốt) takes what is new since the
 * last one: from the participation's countedUntil to the limit of this count.
 */

/** A stretch of time from `start`, up to `end` not included. */
export interface Interval {
    start: Date
    end: Date
}

/** A stretch of a session's focus phase while it ran; `endedAt` empty while it still runs. */
export interface Stretch {
    startedAt: Date
    endedAt: Date | null
}

/** A day of a time zone, as YYYY-MM-DD: the key of DailyStudy. */
export type LocalDate = string

/** The zone of a person without one set (an account not completed yet), as for tasks. */
export const FALLBACK_TIME_ZONE = 'UTC'

/** 16 hours: what goes past it on a day is dropped (REQ-STUDY-04, D-222). */
export const DAILY_CAP_SECONDS = 16 * 60 * 60

/**
 * A time as the study module writes it: down to its whole second (D-224).
 * secondsOf counts the same seconds either way; written whole, the times in
 * the tables are the ones counted, with no part of a second hidden in them.
 */
export const wholeSecond = (at: Date): Date => new Date(Math.floor(at.getTime() / 1000) * 1000)

/** Where a participation's time stops for now (Participation_time_check). */
export interface ParticipationTimes {
    leftAt: Date | null
    awaySince: Date | null
}

/**
 * How far a count at `now` may go: to the time the person left; while away
 * (D-215), to the time they went, since the time away counts only once they
 * come back within 3 minutes, and the count after their return takes it then;
 * otherwise to now.
 */
export const countLimit = (times: ParticipationTimes, now: Date): Date => times.leftAt ?? times.awaySince ?? now

/**
 * The parts of `[from, until)` when a focus phase ran, in order. A stretch
 * still running is taken to run up to `until`, but not past `focusEndsAt`,
 * the end its phase is due: a phase job that runs a little late adds nothing.
 * Parts that overlap (stretches written by two clocks a little apart) are
 * joined, so no second counts twice. A person who came before the session
 * started (19:55 for a session of 20:00) gets nothing before its first
 * stretch, so their time counts from the later of the two by itself.
 */
export function focusedParts(
    from: Date,
    until: Date,
    stretches: readonly Stretch[],
    focusEndsAt: Date | null = null
): Interval[] {
    const runsTo = Math.min(until.getTime(), focusEndsAt?.getTime() ?? Infinity)
    const parts: Interval[] = []
    for (const stretch of stretches) {
        const start = Math.max(from.getTime(), stretch.startedAt.getTime())
        const end = Math.min(until.getTime(), stretch.endedAt?.getTime() ?? runsTo)
        if (start < end) parts.push({ start: new Date(start), end: new Date(end) })
    }
    parts.sort((a, b) => a.start.getTime() - b.start.getTime())
    const joined: Interval[] = []
    for (const part of parts) {
        const last = joined.at(-1)
        if (last && part.start <= last.end) {
            if (part.end > last.end) last.end = part.end
        } else joined.push(part)
    }
    return joined
}

/**
 * The whole seconds of an interval: how many second marks (…:00.000, …:01.000)
 * it passes. Two intervals end to end add up to the one they make, so a
 * session counted many times, or split at midnight, loses no second and counts
 * none twice. One interval is off from its length by less than a second,
 * either way: a stay of 2:59.5 may count 180 seconds. Exact to the
 * millisecond would need the part of a second carried from one count to the
 * next, a column for under a second a stay.
 */
export const secondsOf = ({ start, end }: Interval): number =>
    Math.floor(end.getTime() / 1000) - Math.floor(start.getTime() / 1000)

/** One calendar per zone, made once. */
const calendars = new Map<string, Intl.DateTimeFormat>()
const calendarOf = (timeZone: string): Intl.DateTimeFormat => {
    let calendar = calendars.get(timeZone)
    if (!calendar) {
        calendar = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
        calendars.set(timeZone, calendar)
    }
    return calendar
}

/** The day an instant falls on in a time zone. */
export function localDateOf(at: Date, timeZone: string): LocalDate {
    const parts = calendarOf(timeZone).formatToParts(at)
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((one) => one.type === type)!.value
    return `${part('year')}-${part('month')}-${part('day')}`
}

/** Two days are more than any day of any zone: the next day has begun by then. */
const SEARCH_MS = 2 * 86_400_000

/**
 * The first instant after `at` that falls on a later day of the zone: its
 * midnight, or 01:00 where the clocks skip midnight. Found by halving, which
 * needs no table of the zone's changes of offset. Halving needs the day never
 * to go back: true where clocks go back at midnight too (Santiago goes from
 * 23:59:59 back to 23:00 of the same day).
 */
export function nextDayStart(at: Date, timeZone: string): Date {
    const day = localDateOf(at, timeZone)
    // `low` is still on `day`, `high` no longer is.
    let low = at.getTime()
    let high = low + SEARCH_MS
    while (high - low > 1) {
        const middle = Math.floor((low + high) / 2)
        if (localDateOf(new Date(middle), timeZone) === day) low = middle
        else high = middle
    }
    return new Date(high)
}

/** The seconds of a day, before the 16-hour cap. */
export interface DaySeconds {
    date: LocalDate
    seconds: number
}

/**
 * The seconds of these intervals on each day of the zone, in order of days,
 * days with none left out: a part across midnight goes partly to each day
 * (REQ-STUDY-04).
 */
export function secondsByDay(parts: readonly Interval[], timeZone: string): DaySeconds[] {
    const days = new Map<LocalDate, number>()
    const add = (date: LocalDate, seconds: number) => days.set(date, (days.get(date) ?? 0) + seconds)
    for (const part of parts) {
        let start = part.start
        while (start < part.end) {
            const date = localDateOf(start, timeZone)
            // Most parts are within a day: no search for them.
            const sameDay = localDateOf(new Date(part.end.getTime() - 1), timeZone) === date
            const end = sameDay
                ? part.end
                : new Date(Math.min(nextDayStart(start, timeZone).getTime(), part.end.getTime()))
            add(date, secondsOf({ start, end }))
            start = end
        }
    }
    return [...days]
        .filter(([, seconds]) => seconds > 0)
        .map(([date, seconds]) => ({ date, seconds }))
        .sort((a, b) => (a.date < b.date ? -1 : 1))
}

/**
 * What a day can still take under the 16-hour cap, given what it has: the
 * rest is dropped from the count being made (D-222), so the day's room and
 * Solo seconds still add up to its focused seconds.
 */
export const cappedSeconds = (dayHas: number, adding: number): number =>
    Math.max(0, Math.min(adding, DAILY_CAP_SECONDS - dayHas))
