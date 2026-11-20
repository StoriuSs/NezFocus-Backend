import { StudyCycle, studyCycleProblem } from './study-room.rules'

const cycle = (changed: Partial<StudyCycle> = {}): StudyCycle => ({
    focusMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: null,
    longBreakEvery: null,
    ...changed
})

describe('a study room cycle (SRS 2, S-ROOM-03)', () => {
    it('takes 25/5, 50/10 and a long break of 15 every 4', () => {
        expect(studyCycleProblem(cycle())).toBeNull()
        expect(studyCycleProblem(cycle({ focusMinutes: 50, shortBreakMinutes: 10 }))).toBeNull()
        expect(studyCycleProblem(cycle({ longBreakMinutes: 15, longBreakEvery: 4 }))).toBeNull()
    })

    it.each([
        [{ focusMinutes: 5 }, null],
        [{ focusMinutes: 120 }, null],
        [{ focusMinutes: 4 }, 'focus_minutes'],
        [{ focusMinutes: 121 }, 'focus_minutes'],
        [{ focusMinutes: 25.5 }, 'focus_minutes'],
        [{ shortBreakMinutes: 1 }, null],
        [{ shortBreakMinutes: 30 }, null],
        [{ shortBreakMinutes: 0 }, 'short_break_minutes'],
        [{ shortBreakMinutes: 31 }, 'short_break_minutes'],
        [{ longBreakMinutes: 5, longBreakEvery: 2 }, null],
        [{ longBreakMinutes: 60, longBreakEvery: 8 }, null],
        [{ longBreakMinutes: 4, longBreakEvery: 4 }, 'long_break_minutes'],
        [{ longBreakMinutes: 61, longBreakEvery: 4 }, 'long_break_minutes'],
        [{ longBreakMinutes: 15, longBreakEvery: 1 }, 'long_break_every'],
        [{ longBreakMinutes: 15, longBreakEvery: 9 }, 'long_break_every']
    ])('%j: %s', (changed, problem) => {
        expect(studyCycleProblem(cycle(changed))).toBe(problem)
    })

    it('has both halves of a long break or neither', () => {
        expect(studyCycleProblem(cycle({ longBreakMinutes: 15 }))).toBe('long_break_pair')
        expect(studyCycleProblem(cycle({ longBreakEvery: 4 }))).toBe('long_break_pair')
    })
})
