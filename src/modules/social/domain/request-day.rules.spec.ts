import { nextRequestDay, requestDayOf } from './request-day.rules'

describe('the day a friend request counts against (REQ-SOCIAL-01)', () => {
    // 23:30 on 24/11 in Hồ Chí Minh City is 16:30 UTC.
    const lateEvening = new Date('2026-11-24T16:30:00Z')

    it('is the sender day, not the server one', () => {
        expect(requestDayOf(lateEvening, 'Asia/Ho_Chi_Minh')).toBe('2026-11-24')
        expect(requestDayOf(new Date('2026-11-24T17:00:00Z'), 'Asia/Ho_Chi_Minh')).toBe('2026-11-25')
        expect(requestDayOf(lateEvening, 'America/New_York')).toBe('2026-11-24')
    })

    it('ends at the sender midnight', () => {
        expect(nextRequestDay(lateEvening, 'Asia/Ho_Chi_Minh').toISOString()).toBe('2026-11-24T17:00:00.000Z')
        expect(nextRequestDay(lateEvening, 'UTC').toISOString()).toBe('2026-11-25T00:00:00.000Z')
    })
})
