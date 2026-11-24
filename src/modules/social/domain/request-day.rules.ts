/*
 * The day a friend request counts against (REQ-SOCIAL-01): a day of the
 * sender's own time zone, which ends at their midnight ("Gửi tiếp được từ
 * 00:00 ngày mai"). Study keeps the same two steps for its days
 * (study-time.rules.ts); a module's domain does not import another's.
 */

/** The zone of a person without one set (an account not completed yet), as tasks and study take it. */
export const FALLBACK_TIME_ZONE = 'UTC'

/** One calendar per zone, made once. */
const calendars = new Map<string, Intl.DateTimeFormat>()

/** The day an instant falls on in a time zone, as YYYY-MM-DD. */
export function requestDayOf(at: Date, timeZone: string): string {
    let calendar = calendars.get(timeZone)
    if (!calendar) {
        calendar = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
        calendars.set(timeZone, calendar)
    }
    const parts = calendar.formatToParts(at)
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((one) => one.type === type)!.value
    return `${part('year')}-${part('month')}-${part('day')}`
}

/**
 * The first instant after `at` on a later day of the zone (its midnight, or
 * 01:00 where clocks skip midnight), found by halving over two days, which
 * are more than any day of any zone.
 */
export function nextRequestDay(at: Date, timeZone: string): Date {
    const day = requestDayOf(at, timeZone)
    let low = at.getTime()
    let high = low + 2 * 86_400_000
    while (high - low > 1) {
        const middle = Math.floor((low + high) / 2)
        if (requestDayOf(new Date(middle), timeZone) === day) low = middle
        else high = middle
    }
    return new Date(high)
}
