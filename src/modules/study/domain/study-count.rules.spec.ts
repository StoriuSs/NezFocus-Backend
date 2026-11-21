import { NO_STREAK, shownStreak, StreakState } from './streak.rules'
import { applyCount, countedUntilAfter, newSeconds } from './study-count.rules'
import { Stretch } from './study-time.rules'

const HANOI = 'Asia/Ho_Chi_Minh'
const hanoi = (date: string, time: string) => new Date(`${date}T${time}+07:00`)
const TODAY = '2026-11-20'
const YESTERDAY = '2026-11-19'

/** A Solo focus phase of `minutes` from `time` today in Hà Nội, counted at its end. */
function phase(time: string, minutes: number) {
    const startedAt = hanoi(TODAY, time)
    const endedAt = new Date(startedAt.getTime() + minutes * 60_000)
    const stretches: Stretch[] = [{ startedAt, endedAt }]
    return newSeconds({ from: startedAt, until: endedAt, stretches, focusEndsAt: null, timeZone: HANOI })
}

describe('a count (chốt, ARCHITECTURE 5.2)', () => {
    it('finds nothing when the window is empty', () => {
        const now = hanoi(TODAY, '20:00:00')
        expect(
            newSeconds({
                from: now,
                until: now,
                stretches: [{ startedAt: now, endedAt: null }],
                focusEndsAt: null,
                timeZone: HANOI
            })
        ).toEqual([])
    })

    it('adds a Solo stopped at minute 12 as 12 minutes', () => {
        const found = phase('21:00:00', 12)
        expect(applyCount(found, new Map(), NO_STREAK)).toMatchObject({
            days: [{ date: TODAY, seconds: 720 }],
            seconds: 720
        })
    })

    it('makes a streak of 2 from 20 minutes yesterday, then 10 + 8 today, at the second session', () => {
        const yesterday = applyCount(
            newSeconds({
                from: hanoi(YESTERDAY, '20:00:00'),
                until: hanoi(YESTERDAY, '20:20:00'),
                stretches: [{ startedAt: hanoi(YESTERDAY, '20:00:00'), endedAt: null }],
                focusEndsAt: null,
                timeZone: HANOI
            }),
            new Map(),
            NO_STREAK
        )
        expect(yesterday.streak).toEqual({ current: 1, longest: 1, lastQualifiedDate: YESTERDAY })

        const first = applyCount(phase('08:00:00', 10), new Map(), yesterday.streak)
        expect(first.streakMoved).toBe(false)
        expect(first.streak).toBe(yesterday.streak)
        expect(shownStreak(first.streak, TODAY)).toBe(1)

        const second = applyCount(phase('09:00:00', 8), new Map([[TODAY, 600]]), first.streak)
        expect(second.streakMoved).toBe(true)
        expect(second.streak).toEqual({ current: 2, longest: 2, lastQualifiedDate: TODAY })
    })

    it('keeps the streak at 0 today after 10 minutes yesterday, until today reaches 15', () => {
        // The last qualifying day was the day before yesterday; yesterday's 10 minutes did not qualify.
        const before: StreakState = { current: 4, longest: 4, lastQualifiedDate: '2026-11-18' }
        expect(shownStreak(before, TODAY)).toBe(0)
        const short = applyCount(phase('08:00:00', 14), new Map(), before)
        expect(shownStreak(short.streak, TODAY)).toBe(0)
        const enough = applyCount(phase('09:00:00', 1), new Map([[TODAY, 840]]), short.streak)
        expect(enough.streak).toEqual({ current: 1, longest: 4, lastQualifiedDate: TODAY })
    })

    it('counts a session across 00:00 on both days, each qualifying in order', () => {
        // 23:40 to 00:20 in Hà Nội, the day before having 5 minutes already.
        const found = newSeconds({
            from: hanoi(YESTERDAY, '23:40:00'),
            until: hanoi(TODAY, '00:20:00'),
            stretches: [{ startedAt: hanoi(YESTERDAY, '23:40:00'), endedAt: null }],
            focusEndsAt: null,
            timeZone: HANOI
        })
        const result = applyCount(found, new Map([[YESTERDAY, 300]]), {
            current: 2,
            longest: 3,
            lastQualifiedDate: '2026-11-18'
        })
        expect(result.days).toEqual([
            { date: YESTERDAY, seconds: 1200 },
            { date: TODAY, seconds: 1200 }
        ])
        expect(result.seconds).toBe(2400)
        expect(result.streak).toEqual({ current: 4, longest: 4, lastQualifiedDate: TODAY })
    })

    it('drops what goes past 16 hours, and leaves a full day out', () => {
        const found = phase('20:00:00', 25)
        const nearly = applyCount(found, new Map([[TODAY, 57_000]]), NO_STREAK)
        expect(nearly.days).toEqual([{ date: TODAY, seconds: 600 }])
        expect(nearly.seconds).toBe(600)
        const full = applyCount(found, new Map([[TODAY, 57_600]]), NO_STREAK)
        expect(full).toEqual({ days: [], seconds: 0, streak: NO_STREAK, streakMoved: false })
    })

    it('does not move the streak for a day already counted, though its seconds cross 15 minutes again', () => {
        // A person who moved to a zone further west lives a day of the same date twice.
        const counted: StreakState = { current: 3, longest: 3, lastQualifiedDate: TODAY }
        const result = applyCount(phase('20:00:00', 20), new Map(), counted)
        expect(result.streakMoved).toBe(false)
        expect(result.streak).toBe(counted)
    })

    it('stops a running focus phase where it is due to end, not when its job runs', () => {
        // Focus 20:00 to 20:25, its job late: a person leaving at 20:25:02 gets 25 minutes.
        const startedAt = hanoi(TODAY, '20:00:00')
        const found = newSeconds({
            from: startedAt,
            until: hanoi(TODAY, '20:25:02'),
            stretches: [{ startedAt, endedAt: null }],
            focusEndsAt: hanoi(TODAY, '20:25:00'),
            timeZone: HANOI
        })
        expect(found).toEqual([{ date: TODAY, seconds: 1500 }])
    })
})

describe('where countedUntil goes after a count', () => {
    it('moves to the limit of the count', () => {
        const window = { from: hanoi(TODAY, '20:00:00'), until: hanoi(TODAY, '20:10:00'), focusEndsAt: null }
        expect(countedUntilAfter(window)).toEqual(hanoi(TODAY, '20:10:00'))
    })

    it('never goes back, so a count read before another one moved it counts nothing twice', () => {
        // Another count took countedUntil to 20:10; this one read its limit (20:08) before.
        const window = { from: hanoi(TODAY, '20:10:00'), until: hanoi(TODAY, '20:08:00'), focusEndsAt: null }
        const stretches = [{ startedAt: hanoi(TODAY, '20:00:00'), endedAt: null }]
        expect(newSeconds({ ...window, stretches, timeZone: HANOI })).toEqual([])
        expect(countedUntilAfter(window)).toEqual(hanoi(TODAY, '20:10:00'))
    })

    it('stops where a running focus phase was due to end, so the next count looks at what came after', () => {
        // Focus due to end at 20:25, its job late: a count at 20:27 looks no further than 20:25.
        const window = {
            from: hanoi(TODAY, '20:00:00'),
            until: hanoi(TODAY, '20:27:00'),
            focusEndsAt: hanoi(TODAY, '20:25:00')
        }
        expect(countedUntilAfter(window)).toEqual(hanoi(TODAY, '20:25:00'))
        // Due later than the limit of the count: the count goes to its limit.
        expect(countedUntilAfter({ ...window, focusEndsAt: hanoi(TODAY, '20:30:00') })).toEqual(
            hanoi(TODAY, '20:27:00')
        )
        // And never back, even then.
        expect(countedUntilAfter({ ...window, from: hanoi(TODAY, '20:26:00') })).toEqual(hanoi(TODAY, '20:26:00'))
    })
})
