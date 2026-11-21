import { Cycle } from '../../domain'

/**
 * The cycle a start asks for (a Room Session's or a Solo's): none when no
 * part of one is sent (the room's default, or the last Solo's). A part left
 * out is caught by studyCycleProblem as out of range: focus and short break
 * go together, the long break both halves or neither.
 */
export function askedCycle(cycle: Partial<Cycle>): Cycle | null {
    if (Object.values(cycle).every((part) => part == null)) return null
    return {
        focusMinutes: cycle.focusMinutes as number,
        shortBreakMinutes: cycle.shortBreakMinutes as number,
        longBreakMinutes: cycle.longBreakMinutes ?? null,
        longBreakEvery: cycle.longBreakEvery ?? null
    }
}
