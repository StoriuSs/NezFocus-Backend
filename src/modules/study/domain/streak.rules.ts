/*
 * A person's days in a row with 15 minutes studied (REQ-STUDY-07, ARCHITECTURE
 * 5.2). A day qualifies the moment its seconds reach 900, even mid-session;
 * the run goes on when the day before qualified too, and starts again at 1
 * after a gap.
 */
import type { LocalDate } from './study-time.rules'

/** 15 minutes: a day with this much studied keeps the streak (REQ-STUDY-07). */
export const QUALIFYING_SECONDS = 15 * 60

/** What Streak keeps of a person. */
export interface StreakState {
    /** The run up to lastQualifiedDate. */
    current: number
    longest: number
    lastQualifiedDate: LocalDate | null
}

export const NO_STREAK: StreakState = { current: 0, longest: 0, lastQualifiedDate: null }

/** Whether a day that had `before` seconds and now has `after` has just qualified. */
export const crossesQualifying = (before: number, after: number): boolean =>
    before < QUALIFYING_SECONDS && after >= QUALIFYING_SECONDS

/** The day before, as YYYY-MM-DD. */
export function dayBefore(date: LocalDate): LocalDate {
    const day = new Date(`${date}T00:00:00Z`)
    day.setUTCDate(day.getUTCDate() - 1)
    return day.toISOString().slice(0, 10)
}

/**
 * The streak once `date` qualifies. Days are counted in order, so the day
 * qualifying comes after the last one; a day already counted (or, which a
 * person in one session at a time cannot cause, an earlier one) changes
 * nothing.
 */
export function afterQualifying(streak: StreakState, date: LocalDate): StreakState {
    const last = streak.lastQualifiedDate
    if (last !== null && date <= last) return streak
    const current = last !== null && dayBefore(date) === last ? streak.current + 1 : 1
    return { current, longest: Math.max(streak.longest, current), lastQualifiedDate: date }
}

/**
 * The streak to show on `today`: the run is still alive when its last day is
 * today or yesterday (yesterday's run waits for today to qualify, REQ-STUDY-07),
 * otherwise it shows 0 until a day qualifies again. A last day after today
 * (a person who moved to a zone further west) is alive too. Worked out when
 * read, so a missed day needs no job at midnight.
 */
export const shownStreak = (streak: StreakState, today: LocalDate): number =>
    streak.lastQualifiedDate !== null && streak.lastQualifiedDate >= dayBefore(today) ? streak.current : 0
