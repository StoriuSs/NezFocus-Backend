import { READ_COUNT_CAP, readFloor } from './read-state.rules'

/** A UUIDv7 made at `at`, with these random bits (as the database makes them). */
const v7At = (at: Date, random: string) => {
    const time = at.getTime().toString(16).padStart(12, '0')
    return `${time.slice(0, 8)}-${time.slice(8)}-7${random.slice(0, 3)}-${random.slice(3, 7)}-${random.slice(7, 19)}`
}

describe('readFloor (D-170)', () => {
    const joined = new Date('2026-11-14T08:30:00.123Z')

    it('comes after every message sent before the person joined, and before every one sent after', () => {
        const floor = readFloor(joined)

        const before = v7At(new Date(joined.getTime() - 1), 'fffbfffffffffffffff')
        const after = v7At(new Date(joined.getTime() + 1), '0008000000000000000')
        expect(before < floor).toBe(true)
        expect(floor < after).toBe(true)
    })

    it('comes before a message sent in the very millisecond they joined: it is new to them', () => {
        // The smallest random bits a real id can have past the floor's own.
        expect(readFloor(joined) < v7At(joined, '0008000000000000001')).toBe(true)
    })

    it('is a UUID, so it may stand where a message id goes (a page around it)', () => {
        expect(readFloor(joined)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    })
})

describe('READ_COUNT_CAP (D-173)', () => {
    it('counts to 100, one past what is shown before "99+"', () => {
        expect(READ_COUNT_CAP).toBe(100)
    })
})
