/*
 * What one count (chốt) writes (ARCHITECTURE 5.2): the new seconds of a
 * participation by day, cut to the 16-hour cap, and the streak of the days
 * that reach 15 minutes on the way. Made in two steps so the repository reads
 * only the days a count touches:
 *   1. newSeconds: the seconds since countedUntil by day, before the cap;
 *   2. applyCount: given what those days and the streak have, what to add.
 */
import { afterQualifying, crossesQualifying, StreakState } from './streak.rules'
import { cappedSeconds, DaySeconds, focusedParts, LocalDate, secondsByDay, Stretch } from './study-time.rules'

/** A participation's count, from where the last one stopped. */
export interface CountWindow {
    /** The participation's countedUntil. */
    from: Date
    /** countLimit of the participation at the time of the count. */
    until: Date
    /** The session's focus stretches: all of them, or at least those still running or ended after `from`. */
    stretches: readonly Stretch[]
    /** While a focus phase runs, the end it is due (phaseEndsAt): its stretch counts no further. */
    focusEndsAt: Date | null
    /** The person's time zone at the time of the count (an earlier change does not move older days). */
    timeZone: string
}

/** Step 1: the seconds studied in the window, by day of the person's zone, before the cap. */
export const newSeconds = ({ from, until, stretches, focusEndsAt, timeZone }: CountWindow): DaySeconds[] =>
    secondsByDay(focusedParts(from, until, stretches, focusEndsAt), timeZone)

/**
 * The participation's countedUntil after the count: `until`, or the end the
 * running focus phase was due if that came first, and never back.
 * - Not past `focusEndsAt`: the time after it was not looked at (the stretch
 *   counts no further), so the next count looks at it again. Moved to `until`,
 *   a focus stretch the late phase job opens at its planned time would lose
 *   its start for good.
 * - Never back: a count whose limit was read before another count moved
 *   countedUntil past it finds nothing, and moving countedUntil back would
 *   count the seconds between again.
 */
export function countedUntilAfter({
    from,
    until,
    focusEndsAt
}: Pick<CountWindow, 'from' | 'until' | 'focusEndsAt'>): Date {
    const looked = focusEndsAt !== null && focusEndsAt < until ? focusEndsAt : until
    return looked > from ? looked : from
}

/** What a count writes. */
export interface CountResult {
    /** The seconds to add to each day (room or Solo, by the session's kind), the cap applied; days left with none are left out. */
    days: DaySeconds[]
    /** Their sum: what the participation's seconds go up by. */
    seconds: number
    /** The streak after the count. */
    streak: StreakState
    /** Whether the streak moved (a day reached 15 minutes in this count): then it is written. */
    streakMoved: boolean
}

/**
 * Step 2: cap each day of `found` against what it has (`dayHas`, 0 for a day
 * without a row) and move the streak for each day that crosses 15 minutes,
 * day by day in order.
 */
export function applyCount(
    found: readonly DaySeconds[],
    dayHas: ReadonlyMap<LocalDate, number>,
    streak: StreakState
): CountResult {
    const days: DaySeconds[] = []
    let next = streak
    let streakMoved = false
    for (const { date, seconds } of found) {
        const before = dayHas.get(date) ?? 0
        const added = cappedSeconds(before, seconds)
        if (added === 0) continue
        days.push({ date, seconds: added })
        if (!crossesQualifying(before, before + added)) continue
        const moved = afterQualifying(next, date)
        if (moved !== next) {
            next = moved
            streakMoved = true
        }
    }
    return { days, seconds: days.reduce((sum, day) => sum + day.seconds, 0), streak: next, streakMoved }
}
