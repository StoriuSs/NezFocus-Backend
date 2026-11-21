import { fromDateColumn, toDateColumn } from './study-counts'

describe('days as a @db.Date column takes them (D-224)', () => {
    it('writes a day as its midnight in UTC, whatever the zone the server runs in', () => {
        expect(toDateColumn('2026-11-20').toISOString()).toBe('2026-11-20T00:00:00.000Z')
        expect(toDateColumn('2027-01-01').getTime()).toBe(Date.UTC(2027, 0, 1))
    })

    it('reads the column back as the same day', () => {
        for (const date of ['2026-11-20', '2026-12-31', '2028-02-29']) {
            expect(fromDateColumn(toDateColumn(date))).toBe(date)
        }
        // As Prisma gives a date column: its midnight in UTC.
        expect(fromDateColumn(new Date('2026-11-21T00:00:00.000Z'))).toBe('2026-11-21')
    })
})
