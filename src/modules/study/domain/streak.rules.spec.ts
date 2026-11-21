import {
    afterQualifying,
    crossesQualifying,
    dayBefore,
    NO_STREAK,
    QUALIFYING_SECONDS,
    shownStreak,
    StreakState
} from './streak.rules'

const streak = (current: number, longest: number, lastQualifiedDate: string | null): StreakState => ({
    current,
    longest,
    lastQualifiedDate
})

describe('a qualifying day (REQ-STUDY-07)', () => {
    it('qualifies the moment it reaches 15 minutes, once', () => {
        expect(QUALIFYING_SECONDS).toBe(900)
        expect(crossesQualifying(600, 899)).toBe(false)
        expect(crossesQualifying(600, 900)).toBe(true)
        expect(crossesQualifying(0, 1200)).toBe(true)
        expect(crossesQualifying(900, 1500)).toBe(false)
    })

    it('reads the day before across months and years', () => {
        expect(dayBefore('2026-11-21')).toBe('2026-11-20')
        expect(dayBefore('2026-03-01')).toBe('2026-02-28')
        expect(dayBefore('2028-03-01')).toBe('2028-02-29')
        expect(dayBefore('2027-01-01')).toBe('2026-12-31')
    })
})

describe('the streak once a day qualifies (REQ-STUDY-07)', () => {
    it('starts at 1 for a first day', () => {
        expect(afterQualifying(NO_STREAK, '2026-11-20')).toEqual(streak(1, 1, '2026-11-20'))
    })

    it('goes on from yesterday, also across a month', () => {
        expect(afterQualifying(streak(1, 1, '2026-11-19'), '2026-11-20')).toEqual(streak(2, 2, '2026-11-20'))
        expect(afterQualifying(streak(4, 6, '2026-10-31'), '2026-11-01')).toEqual(streak(5, 6, '2026-11-01'))
    })

    it('starts again at 1 after a day missed, keeping the longest', () => {
        expect(afterQualifying(streak(5, 7, '2026-11-18'), '2026-11-20')).toEqual(streak(1, 7, '2026-11-20'))
    })

    it('changes nothing for a day already counted', () => {
        const today = streak(3, 3, '2026-11-20')
        expect(afterQualifying(today, '2026-11-20')).toBe(today)
        expect(afterQualifying(today, '2026-11-19')).toBe(today)
    })
})

describe('the streak shown (REQ-STUDY-07)', () => {
    it('shows the run while its last day is today or yesterday, 0 once a day is missed', () => {
        expect(shownStreak(streak(3, 4, '2026-11-20'), '2026-11-20')).toBe(3)
        // Yesterday qualified, today not yet: the run waits for today.
        expect(shownStreak(streak(3, 4, '2026-11-19'), '2026-11-20')).toBe(3)
        expect(shownStreak(streak(3, 4, '2026-11-18'), '2026-11-20')).toBe(0)
        expect(shownStreak(NO_STREAK, '2026-11-20')).toBe(0)
    })

    it('shows the run whose last day is after today, for a person who moved to a zone further west', () => {
        // Qualified at 00:30 on 21/11 in Hà Nội, then moved to New York, where it is still 20/11.
        expect(shownStreak(streak(3, 4, '2026-11-21'), '2026-11-20')).toBe(3)
    })
})
