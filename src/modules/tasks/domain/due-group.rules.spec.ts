import { dueGroupOf, isDueSoon } from './due-group.rules'

describe('dueGroupOf (REQ-TASK-05, D-186)', () => {
    // 21:47 on Saturday 17/10/2026 in Hà Nội (UTC+7), the spec's world A.
    const now = new Date('2026-10-17T14:47:00Z')
    const HANOI = 'Asia/Ho_Chi_Minh'

    it('puts each task in the group of spec 05, read in Hà Nội', () => {
        const group = (iso: string | null) => dueGroupOf(iso === null ? null : new Date(iso), now, HANOI)
        expect(group('2026-10-16T16:59:00Z')).toBe('overdue') // 16/10 23:59
        expect(group('2026-10-17T14:00:00Z')).toBe('overdue') // today 21:00, already past
        expect(group('2026-10-17T14:47:00Z')).toBe('overdue') // due this very minute
        expect(group('2026-10-17T16:59:00Z')).toBe('today') // today 23:59
        expect(group('2026-10-17T17:00:00Z')).toBe('next_7_days') // tomorrow 00:00
        expect(group('2026-10-23T16:59:00Z')).toBe('next_7_days') // Friday 23/10, today + 6
        expect(group('2026-10-23T17:00:00Z')).toBe('later') // Saturday 24/10 00:00, today + 7
        expect(group('2026-11-05T16:59:00Z')).toBe('later')
        expect(group(null)).toBe('no_due')
    })

    it('counts days in the reader’s zone, not the server’s', () => {
        // 23:00 on 17/10 in Hà Nội is 16:00 UTC, 12:00 in New York, 01:00 on 18/10 in Tokyo.
        const due = new Date('2026-10-17T16:00:00Z')
        expect(dueGroupOf(due, now, HANOI)).toBe('today')
        expect(dueGroupOf(due, now, 'UTC')).toBe('today')
        expect(dueGroupOf(due, now, 'America/New_York')).toBe('today')
        // Now is 23:47 on 17/10 in Tokyo, the due time 01:00 on 18/10: tomorrow there.
        expect(dueGroupOf(due, now, 'Asia/Tokyo')).toBe('next_7_days')
        // Now is 04:47 on 18/10 in Kiritimati (UTC+14), the due time 06:00 the same day.
        expect(dueGroupOf(due, now, 'Pacific/Kiritimati')).toBe('today')
    })

    it('crosses a change of daylight saving time by calendar days', () => {
        // New York leaves daylight saving at 02:00 on 01/11/2026: that day has 25 hours.
        const late = new Date('2026-10-31T23:00:00Z') // 19:00 on Saturday 31/10 in New York
        expect(dueGroupOf(new Date('2026-11-07T04:59:00Z'), late, 'America/New_York')).toBe('next_7_days') // 06/11 23:59
        expect(dueGroupOf(new Date('2026-11-07T05:00:00Z'), late, 'America/New_York')).toBe('later') // 07/11 00:00
    })

    it('crosses into a new year', () => {
        const eve = new Date('2026-12-31T10:00:00Z') // 17:00 on 31/12 in Hà Nội
        expect(dueGroupOf(new Date('2027-01-01T16:59:00Z'), eve, HANOI)).toBe('next_7_days')
        expect(dueGroupOf(new Date('2027-01-06T16:59:00Z'), eve, HANOI)).toBe('next_7_days')
        expect(dueGroupOf(new Date('2027-01-07T16:59:00Z'), eve, HANOI)).toBe('later')
    })

    it('counts only overdue and today towards the rail badge', () => {
        expect(['overdue', 'today', 'next_7_days', 'later', 'no_due'].filter((g) => isDueSoon(g as never))).toEqual([
            'overdue',
            'today'
        ])
    })
})
