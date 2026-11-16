import { SIGNAL_WINDOW_MS, SIGNALS_PER_WINDOW, takeSignal } from './signal.rules'

const NOW = Date.parse('2026-11-16T10:00:00Z')

/** Sends `count` signals a millisecond apart from `from`, returning what is kept after. */
const send = (count: number, from: number, takenAt: number[] = []): { taken: boolean[]; takenAt: number[] } => {
    const taken: boolean[] = []
    for (let i = 0; i < count; i++) {
        const next = takeSignal(takenAt, from + i)
        taken.push(next.taken)
        takenAt = next.takenAt
    }
    return { taken, takenAt }
}

describe('Signals one socket may send (5.3 of the M2 review)', () => {
    it('takes 30 signals in 10 seconds and ignores the 31st', () => {
        expect(SIGNALS_PER_WINDOW).toBe(30)
        expect(SIGNAL_WINDOW_MS).toBe(10_000)
        const { taken } = send(31, NOW)
        expect(taken.slice(0, 30).every(Boolean)).toBe(true)
        expect(taken[30]).toBe(false)
    })

    it('takes signals again once the first of the window is 10 seconds old', () => {
        const { takenAt } = send(30, NOW)
        expect(takeSignal(takenAt, NOW + SIGNAL_WINDOW_MS - 1).taken).toBe(false)
        expect(takeSignal(takenAt, NOW + SIGNAL_WINDOW_MS).taken).toBe(true)
    })

    it('does not count a signal it ignores: a socket that stops is heard a window after its burst', () => {
        const burst = send(30, NOW)
        const refused = send(1000, NOW + 30, burst.takenAt)
        expect(refused.taken.every((taken) => !taken)).toBe(true)
        expect(takeSignal(refused.takenAt, NOW + 29 + SIGNAL_WINDOW_MS).taken).toBe(true)
    })

    it('keeps no more than one window of signals', () => {
        const { takenAt } = send(30, NOW)
        expect(takeSignal(takenAt, NOW + 3 * SIGNAL_WINDOW_MS).takenAt).toEqual([NOW + 3 * SIGNAL_WINDOW_MS])
    })
})
