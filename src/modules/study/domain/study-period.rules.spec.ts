import {
    addDays,
    averageSeconds,
    comparedDays,
    dayCount,
    dayStartIn,
    elapsedDays,
    gridOf,
    instantsOf,
    mayBeBestWeek,
    periodOf,
    previousPeriod,
    weekStartOf
} from './study-period.rules'

describe('the periods of the Stats page (D-105)', () => {
    it('names a week by any of its days, Monday to Sunday', () => {
        expect(weekStartOf('2026-10-18')).toBe('2026-10-12') // a Sunday
        expect(weekStartOf('2026-10-12')).toBe('2026-10-12') // a Monday
        expect(weekStartOf('2026-10-14')).toBe('2026-10-12')
        expect(periodOf('week', '2026-10-15')).toEqual({ view: 'week', start: '2026-10-12', end: '2026-10-18' })
    })

    it('runs a week across the new year (year-boundary)', () => {
        expect(periodOf('week', '2027-01-03')).toEqual({ view: 'week', start: '2026-12-28', end: '2027-01-03' })
    })

    it('names a month by any of its days, to its last day', () => {
        expect(periodOf('month', '2026-10-18')).toEqual({ view: 'month', start: '2026-10-01', end: '2026-10-31' })
        expect(periodOf('month', '2026-09-30').end).toBe('2026-09-30')
        expect(periodOf('month', '2028-02-10').end).toBe('2028-02-29')
        expect(periodOf('month', '2026-12-31')).toEqual({ view: 'month', start: '2026-12-01', end: '2026-12-31' })
    })

    it('goes back one period', () => {
        expect(previousPeriod(periodOf('week', '2026-10-14')).start).toBe('2026-10-05')
        expect(previousPeriod(periodOf('month', '2027-01-15'))).toEqual({
            view: 'month',
            start: '2026-12-01',
            end: '2026-12-31'
        })
    })

    it('counts days, both ends in', () => {
        expect(dayCount('2026-10-12', '2026-10-12')).toBe(1)
        expect(dayCount('2026-10-12', '2026-10-18')).toBe(7)
        expect(dayCount('2026-10-12', '2026-10-11')).toBe(0)
        expect(dayCount('2026-03-01', '2026-03-31')).toBe(31)
        expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    })
})

describe('the numbers of a period (spec 08 S-STUDY-03)', () => {
    const week = periodOf('week', '2026-10-12')
    const october = periodOf('month', '2026-10-01')

    it('counts the days gone by, today in, all of a past period, none of one ahead', () => {
        expect(elapsedDays(week, '2026-10-14')).toBe(3)
        expect(elapsedDays(week, '2026-10-12')).toBe(1)
        expect(elapsedDays(week, '2026-10-25')).toBe(7)
        expect(elapsedDays(week, '2026-10-11')).toBe(0)
    })

    it('compares a period running with as many first days of the one before', () => {
        expect(comparedDays(week, '2026-10-14')).toEqual({ start: '2026-10-05', end: '2026-10-07' })
        expect(comparedDays(october, '2026-10-18')).toEqual({ start: '2026-09-01', end: '2026-09-18' })
    })

    it('compares a period gone by with all of the one before', () => {
        expect(comparedDays(week, '2026-10-19')).toEqual({ start: '2026-10-05', end: '2026-10-11' })
        expect(comparedDays(periodOf('month', '2026-09-01'), '2026-10-18')).toEqual({
            start: '2026-08-01',
            end: '2026-08-31'
        })
    })

    it('never compares past the end of a shorter period before (31/10 with all of September)', () => {
        expect(comparedDays(october, '2026-10-31')).toEqual({ start: '2026-09-01', end: '2026-09-30' })
        expect(comparedDays(periodOf('month', '2026-03-01'), '2026-03-30')).toEqual({
            start: '2026-02-01',
            end: '2026-02-28'
        })
    })

    it('compares nothing for a period still ahead', () => {
        expect(comparedDays(week, '2026-10-11')).toBeNull()
    })

    it('averages over the days gone by, rounded down (39 and 28 minutes of spec 08)', () => {
        expect(averageSeconds(275 * 60, week, '2026-10-18')).toBe(2357) // 39 minutes 17 seconds
        expect(averageSeconds(505 * 60, october, '2026-10-18')).toBe(1683) // 28 minutes
        expect(averageSeconds(600, week, '2026-10-12')).toBe(600)
        expect(averageSeconds(11, week, '2026-10-13')).toBe(5) // 5.5 down, not up
        expect(averageSeconds(0, week, '2026-10-11')).toBe(0)
    })

    it('ends the 4-week grid on the Sunday of the week shown (21/09 – 18/10)', () => {
        expect(gridOf(week)).toEqual({ start: '2026-09-21', end: '2026-10-18' })
        expect(dayCount(gridOf(week).start, gridOf(week).end)).toBe(28)
    })

    it('never takes the first week with seconds, nor one before, as the best (D-230)', () => {
        expect(mayBeBestWeek(week, null)).toBe(false)
        expect(mayBeBestWeek(week, '2026-10-15')).toBe(false)
        expect(mayBeBestWeek(week, '2026-10-12')).toBe(false)
        expect(mayBeBestWeek(week, '2026-11-02')).toBe(false)
        expect(mayBeBestWeek(week, '2026-10-11')).toBe(true)
    })
})

describe('a period in a time zone (D-229)', () => {
    it('starts a day at its midnight in the zone', () => {
        expect(dayStartIn('2026-10-18', 'Asia/Ho_Chi_Minh').toISOString()).toBe('2026-10-17T17:00:00.000Z')
        expect(dayStartIn('2026-10-18', 'UTC').toISOString()).toBe('2026-10-18T00:00:00.000Z')
        expect(dayStartIn('2026-10-18', 'Pacific/Kiritimati').toISOString()).toBe('2026-10-17T10:00:00.000Z')
        expect(dayStartIn('2026-10-18', 'Pacific/Pago_Pago').toISOString()).toBe('2026-10-18T11:00:00.000Z')
    })

    it('starts a day at 01:00 where the clocks skip midnight (Santiago, 06/09/2026)', () => {
        expect(dayStartIn('2026-09-06', 'America/Santiago').toISOString()).toBe('2026-09-06T04:00:00.000Z')
        expect(dayStartIn('2026-09-07', 'America/Santiago').toISOString()).toBe('2026-09-07T03:00:00.000Z')
    })

    it('gives a period its instants, the day after its end not in', () => {
        expect(instantsOf(periodOf('week', '2026-10-14'), 'Asia/Ho_Chi_Minh')).toEqual({
            from: new Date('2026-10-11T17:00:00.000Z'),
            to: new Date('2026-10-18T17:00:00.000Z')
        })
    })
})
