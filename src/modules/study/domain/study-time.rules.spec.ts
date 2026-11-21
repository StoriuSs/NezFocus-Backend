import {
    cappedSeconds,
    countLimit,
    DAILY_CAP_SECONDS,
    focusedParts,
    localDateOf,
    nextDayStart,
    secondsByDay,
    secondsOf,
    Stretch,
    wholeSecond
} from './study-time.rules'

const HANOI = 'Asia/Ho_Chi_Minh'
/** A time of Friday 20/11/2026 in Hà Nội (UTC+7). */
const at = (time: string) => new Date(`2026-11-20T${time}+07:00`)
const stretch = (from: string, to: string | null): Stretch => ({
    startedAt: at(from),
    endedAt: to === null ? null : at(to)
})
/** The seconds of one participation from `from` to `until` over these stretches. */
const counted = (from: string, until: string, stretches: Stretch[]) =>
    focusedParts(at(from), at(until), stretches).reduce((sum, part) => sum + secondsOf(part), 0)

describe('the seconds of a participation (REQ-STUDY-04, D-216)', () => {
    // A 25-minute focus phase from 20:00, then a short break.
    const focus = [stretch('20:00:00', '20:25:00')]

    it('counts a focus phase left at 12:40 as 760 seconds (12 minutes shown)', () => {
        expect(counted('20:00:00', '20:12:40', focus)).toBe(760)
    })

    it('adds five stays of 2:59 to 14:55, not to 10 minutes', () => {
        const stays = [0, 1, 2, 3, 4].map((n) => {
            const from = new Date(at('20:00:00').getTime() + n * 180_000)
            return focusedParts(from, new Date(from.getTime() + 179_000), focus)
        })
        expect(stays.flat().reduce((sum, part) => sum + secondsOf(part), 0)).toBe(14 * 60 + 55)
    })

    it('counts from the session’s start for one who came at 19:55', () => {
        expect(counted('19:55:00', '20:10:00', focus)).toBe(600)
    })

    it('leaves out the breaks and the time paused: only the stretches count', () => {
        // Focus 20:00–20:10, paused to 20:13, focus again to 20:28, a break to 20:33, focus from 20:33 still running.
        const stretches = [stretch('20:00:00', '20:10:00'), stretch('20:13:00', '20:28:00'), stretch('20:33:00', null)]
        expect(counted('19:58:00', '20:40:00', stretches)).toBe((10 + 15 + 7) * 60)
    })

    it('takes a stretch still running up to the count, not past it', () => {
        expect(focusedParts(at('20:00:00'), at('20:05:00'), [stretch('20:00:00', null)])).toEqual([
            { start: at('20:00:00'), end: at('20:05:00') }
        ])
    })

    it('counts nothing for a stay that missed every stretch', () => {
        expect(focusedParts(at('20:25:00'), at('20:30:00'), focus)).toEqual([])
        expect(focusedParts(at('20:10:00'), at('20:10:00'), focus)).toEqual([])
    })

    it('starts a Solo’s new focus phase when “Học tiếp” is pressed, not when the break ended', () => {
        // The break ended at 22:00, Học tiếp at 22:04: the stretch opens at 22:04.
        expect(counted('21:30:00', '22:10:00', [stretch('21:30:00', '21:55:00'), stretch('22:04:00', null)])).toBe(
            (25 + 6) * 60
        )
    })

    it('gives the parts in order of time, whatever the order of the stretches', () => {
        const parts = focusedParts(at('20:00:00'), at('21:00:00'), [
            stretch('20:40:00', '20:50:00'),
            stretch('20:00:00', '20:10:00')
        ])
        expect(parts.map((part) => part.start)).toEqual([at('20:00:00'), at('20:40:00')])
    })

    it('joins stretches that overlap, so no second counts twice', () => {
        // Two clocks a little apart: the next stretch opens before the last one closed.
        const stretches = [stretch('20:00:00', '20:10:00.500'), stretch('20:10:00.200', '20:20:00')]
        expect(focusedParts(at('20:00:00'), at('21:00:00'), stretches)).toEqual([
            { start: at('20:00:00'), end: at('20:20:00') }
        ])
        expect(counted('20:00:00', '21:00:00', stretches)).toBe(1200)
        // One inside another.
        expect(
            counted('20:00:00', '21:00:00', [stretch('20:00:00', '20:30:00'), stretch('20:05:00', '20:10:00')])
        ).toBe(1800)
    })

    it('stops a running stretch where its phase is due to end', () => {
        expect(focusedParts(at('20:00:00'), at('20:25:03'), [stretch('20:00:00', null)], at('20:25:00'))).toEqual([
            { start: at('20:00:00'), end: at('20:25:00') }
        ])
        // A stretch already closed keeps its own end.
        expect(focusedParts(at('20:00:00'), at('20:30:00'), [stretch('20:00:00', '20:10:00')], at('20:05:00'))).toEqual(
            [{ start: at('20:00:00'), end: at('20:10:00') }]
        )
    })
})

describe('how far a count goes (D-215)', () => {
    const now = at('20:20:00')

    it('goes to now while the person is there, to the time they left once they did', () => {
        expect(countLimit({ leftAt: null, awaySince: null }, now)).toEqual(now)
        expect(countLimit({ leftAt: at('20:12:40'), awaySince: null }, now)).toEqual(at('20:12:40'))
    })

    it('stops where the person went away: the time away counts only once they are back', () => {
        expect(countLimit({ leftAt: null, awaySince: at('20:10:00') }, now)).toEqual(at('20:10:00'))
        // Closed after 3 minutes away: at the time they went.
        expect(countLimit({ leftAt: at('20:10:00'), awaySince: null }, now)).toEqual(at('20:10:00'))
    })

    it('does not count 10 minutes of a lost connection, and counts 2 minutes away once back', () => {
        const focus = [stretch('20:00:00', '20:25:00')]
        // Lost at 20:05, not back in 3 minutes: closed at 20:05; back at 20:15 is a new stay.
        const lost = counted('20:00:00', '20:05:00', focus) + counted('20:15:00', '20:25:00', focus)
        expect(lost).toBe(15 * 60)
        // Away from 20:05 to 20:07: a count at 20:06 stops at 20:05, the one after the return takes all from there.
        const away = counted('20:00:00', '20:05:00', focus) + counted('20:05:00', '20:25:00', focus)
        expect(away).toBe(25 * 60)
    })
})

describe('whole seconds (secondsOf)', () => {
    const interval = (start: number, end: number) => ({ start: new Date(start), end: new Date(end) })

    it('counts the second marks an interval passes', () => {
        expect(secondsOf(interval(0, 1000))).toBe(1)
        expect(secondsOf(interval(300, 1299))).toBe(1)
        expect(secondsOf(interval(300, 999))).toBe(0)
        expect(secondsOf(interval(999, 1001))).toBe(1)
    })

    it('takes a time down to its whole second, which counts the same seconds as the time itself', () => {
        expect(wholeSecond(new Date('2026-11-20T13:00:05.999Z'))).toEqual(new Date('2026-11-20T13:00:05Z'))
        expect(wholeSecond(new Date('2026-11-20T13:00:05Z'))).toEqual(new Date('2026-11-20T13:00:05Z'))
        // Five stays of 2:59.5 from 20:00:00.700: each passes 180 second marks, written whole or not.
        const stays = [0, 1, 2, 3, 4].map((n) => {
            const start = new Date(at('20:00:00.700').getTime() + n * 180_000)
            return { start, end: new Date(start.getTime() + 179_500) }
        })
        const written = stays.map(({ start, end }) => ({ start: wholeSecond(start), end: wholeSecond(end) }))
        expect(stays.map(secondsOf)).toEqual(written.map(secondsOf))
        // Off from 14:57.5 by under a second a stay, never more however many counts.
        expect(stays.reduce((sum, stay) => sum + secondsOf(stay), 0)).toBe(900)
    })

    it('loses nothing and counts nothing twice over many counts in a row', () => {
        // Counted every 1.7 s for a minute: the same as counted once.
        let total = 0
        let from = 250
        for (let until = from + 1700; until < 60_250; until += 1700) {
            total += secondsOf(interval(from, until))
            from = until
        }
        total += secondsOf(interval(from, 60_250))
        expect(total).toBe(secondsOf(interval(250, 60_250)))
        expect(total).toBe(60)
    })
})

describe('days of a time zone (REQ-STUDY-04, D-104)', () => {
    it('reads the day an instant falls on in the zone', () => {
        const instant = new Date('2026-11-20T16:59:59Z')
        expect(localDateOf(instant, HANOI)).toBe('2026-11-20')
        expect(localDateOf(new Date('2026-11-20T17:00:00Z'), HANOI)).toBe('2026-11-21')
        expect(localDateOf(instant, 'America/New_York')).toBe('2026-11-20')
        expect(localDateOf(instant, 'Pacific/Kiritimati')).toBe('2026-11-21')
        expect(localDateOf(new Date('2026-01-05T00:00:00Z'), 'UTC')).toBe('2026-01-05')
    })

    it('finds the next midnight, half-hour zones included', () => {
        expect(nextDayStart(new Date('2026-11-20T15:00:00Z'), HANOI)).toEqual(new Date('2026-11-20T17:00:00Z'))
        expect(nextDayStart(new Date('2026-11-20T16:59:59.999Z'), HANOI)).toEqual(new Date('2026-11-20T17:00:00Z'))
        expect(nextDayStart(new Date('2026-11-20T17:00:00Z'), HANOI)).toEqual(new Date('2026-11-21T17:00:00Z'))
        expect(nextDayStart(new Date('2026-11-20T12:00:00Z'), 'Asia/Kathmandu')).toEqual(
            new Date('2026-11-20T18:15:00Z')
        )
    })

    it('starts the day at 01:00 where the clocks skip midnight', () => {
        // Santiago goes from 23:59:59 on 05/09/2026 to 01:00 on 06/09.
        expect(nextDayStart(new Date('2026-09-06T03:30:00Z'), 'America/Santiago')).toEqual(
            new Date('2026-09-06T04:00:00Z')
        )
    })

    it('splits a stretch across 00:00 between the two days, by the person’s zone', () => {
        // 23:50 to 00:15 in Hà Nội; the same instants are 11:50 to 12:15 in New York, all on one day.
        const part = { start: new Date('2026-11-20T16:50:00Z'), end: new Date('2026-11-20T17:15:00Z') }
        expect(secondsByDay([part], HANOI)).toEqual([
            { date: '2026-11-20', seconds: 600 },
            { date: '2026-11-21', seconds: 900 }
        ])
        expect(secondsByDay([part], 'America/New_York')).toEqual([{ date: '2026-11-20', seconds: 1500 }])
        // 22:20 to 22:45 in Kathmandu (UTC+5:45), 05:50 to 06:15 the next day in Kiritimati (UTC+14).
        expect(secondsByDay([part], 'Asia/Kathmandu')).toEqual([{ date: '2026-11-20', seconds: 1500 }])
        expect(secondsByDay([part], 'Pacific/Kiritimati')).toEqual([{ date: '2026-11-21', seconds: 1500 }])
    })

    it('splits at 01:00 where midnight is skipped, and puts the repeated hour of a 25-hour day on that day', () => {
        // 23:50 on 05/09 to 01:20 on 06/09 in Santiago: 10 minutes, then 20.
        const spring = { start: new Date('2026-09-06T03:50:00Z'), end: new Date('2026-09-06T04:20:00Z') }
        expect(secondsByDay([spring], 'America/Santiago')).toEqual([
            { date: '2026-09-05', seconds: 600 },
            { date: '2026-09-06', seconds: 1200 }
        ])
        // On 04/04/2026 Santiago goes back from 23:59:59 to 23:00: an hour from 02:30Z is all on 04/04.
        const autumn = { start: new Date('2026-04-05T02:30:00Z'), end: new Date('2026-04-05T03:30:00Z') }
        expect(secondsByDay([autumn], 'America/Santiago')).toEqual([{ date: '2026-04-04', seconds: 3600 }])
    })

    it('adds the parts of a day together, days in order, the split losing no second', () => {
        const parts = [
            { start: new Date('2026-11-20T16:40:00.400Z'), end: new Date('2026-11-20T16:50:00.100Z') },
            { start: new Date('2026-11-20T16:55:00.700Z'), end: new Date('2026-11-20T17:05:00.300Z') }
        ]
        const days = secondsByDay(parts, HANOI)
        expect(days.map((day) => day.date)).toEqual(['2026-11-20', '2026-11-21'])
        expect(days.reduce((sum, day) => sum + day.seconds, 0)).toBe(secondsOf(parts[0]) + secondsOf(parts[1]))
    })

    it('leaves out a day that gets no whole second', () => {
        const part = { start: new Date('2026-11-20T16:59:59.500Z'), end: new Date('2026-11-20T16:59:59.900Z') }
        expect(secondsByDay([part], HANOI)).toEqual([])
    })
})

describe('the 16-hour cap (REQ-STUDY-04, D-222)', () => {
    it('lets a day take up to 16 hours and drops the rest of the count being made', () => {
        expect(DAILY_CAP_SECONDS).toBe(57_600)
        expect(cappedSeconds(0, 1500)).toBe(1500)
        expect(cappedSeconds(57_000, 1500)).toBe(600)
        expect(cappedSeconds(57_600, 1500)).toBe(0)
        // Never written (DailyStudy_seconds_check), but a day read past the cap takes nothing, not a negative.
        expect(cappedSeconds(57_700, 1500)).toBe(0)
    })
})
