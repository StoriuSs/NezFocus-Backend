import { eventIds } from './task-event-ids'

const AT = new Date('2026-11-17T14:47:00.123Z')

describe('the ids of history lines (REQ-TASK-03)', () => {
    it('are UUIDv7 of the write, in the order given', () => {
        const ids = eventIds(3, AT, null)
        expect(ids).toEqual([...ids].sort())
        for (const id of ids) {
            expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
            expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(AT.getTime())
        }
    })

    it('sort above the last line of the task even in the same millisecond, or a clock behind it', () => {
        for (let round = 0; round < 50; round++) {
            const [first] = eventIds(1, AT, null)
            const [next] = eventIds(1, AT, first!)
            expect(next! > first!).toBe(true)
            const [behind] = eventIds(1, new Date(AT.getTime() - 5), next!)
            expect(behind! > next!).toBe(true)
        }
    })

    it('start afresh in a later millisecond', () => {
        const [first] = eventIds(1, AT, null)
        const [later] = eventIds(1, new Date(AT.getTime() + 1), first!)
        expect(later! > first!).toBe(true)
        expect(parseInt(later!.replace(/-/g, '').slice(0, 12), 16)).toBe(AT.getTime() + 1)
    })
})
