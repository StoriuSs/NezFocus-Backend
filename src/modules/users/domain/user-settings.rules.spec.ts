import { TIMEZONE_CHANGE_INTERVAL_MS, timezoneChangeableAt } from './user-settings.rules'

// REQ-AUTH-08, D-22: the time zone changes at most once every 24 hours.
describe('timezoneChangeableAt', () => {
    const now = new Date('2026-11-07T14:47:00Z')
    const ago = (ms: number) => new Date(now.getTime() - ms)

    it('allows a change when the zone was never changed in the settings (the pick when completing does not count)', () => {
        expect(timezoneChangeableAt(null, now)).toBeNull()
    })

    it('names the moment 24 hours after the last change while it is still ahead', () => {
        expect(timezoneChangeableAt(ago(60_000), now)).toEqual(
            new Date(now.getTime() - 60_000 + TIMEZONE_CHANGE_INTERVAL_MS)
        )
    })

    it('allows a change exactly 24 hours after the last one, and later', () => {
        expect(timezoneChangeableAt(ago(TIMEZONE_CHANGE_INTERVAL_MS), now)).toBeNull()
        expect(timezoneChangeableAt(ago(TIMEZONE_CHANGE_INTERVAL_MS + 1), now)).toBeNull()
    })

    it('still waits one millisecond before the 24 hours are up', () => {
        expect(timezoneChangeableAt(ago(TIMEZONE_CHANGE_INTERVAL_MS - 1), now)).toEqual(new Date(now.getTime() + 1))
    })
})
