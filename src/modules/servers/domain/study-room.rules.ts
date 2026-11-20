/**
 * A study room's settings (REQ-STUDY-01, SRS 2): who may start a session,
 * and the cycle a new session starts with. A cycle is whole minutes of focus
 * (5–120) and short break (1–30), and optionally a long break (5–60) after
 * every 2–8 focus phases: both halves of the long break, or neither. The
 * database checks the same ranges (Channel_study_cycle_check).
 */
export type StudyStarter = 'anyone' | 'managers'

export const STUDY_CYCLE_LIMITS = {
    focusMinutes: { min: 5, max: 120 },
    shortBreakMinutes: { min: 1, max: 30 },
    longBreakMinutes: { min: 5, max: 60 },
    longBreakEvery: { min: 2, max: 8 }
} as const

/** What a new room has, as the columns default: anyone may start, 25/5, no long break. */
export const DEFAULT_STUDY_SETTINGS: {
    studyStarter: StudyStarter
    studyFocusMinutes: number
    studyShortBreakMinutes: number
    studyLongBreakMinutes: number | null
    studyLongBreakEvery: number | null
} = {
    studyStarter: 'anyone',
    studyFocusMinutes: 25,
    studyShortBreakMinutes: 5,
    studyLongBreakMinutes: null,
    studyLongBreakEvery: null
}

export interface StudyCycle {
    focusMinutes: number
    shortBreakMinutes: number
    /** Null, with `longBreakEvery`: no long break. */
    longBreakMinutes: number | null
    longBreakEvery: number | null
}

/** Which part of a cycle is out of range, or `long_break_pair` when only one half of the long break is set. */
export type StudyCycleProblem =
    | 'focus_minutes'
    | 'short_break_minutes'
    | 'long_break_minutes'
    | 'long_break_every'
    | 'long_break_pair'

const within = (value: number, { min, max }: { min: number; max: number }) =>
    Number.isInteger(value) && value >= min && value <= max

/** Why a cycle cannot be used, or null when it can. */
export function studyCycleProblem(cycle: StudyCycle): StudyCycleProblem | null {
    if (!within(cycle.focusMinutes, STUDY_CYCLE_LIMITS.focusMinutes)) return 'focus_minutes'
    if (!within(cycle.shortBreakMinutes, STUDY_CYCLE_LIMITS.shortBreakMinutes)) return 'short_break_minutes'
    if ((cycle.longBreakMinutes === null) !== (cycle.longBreakEvery === null)) return 'long_break_pair'
    if (cycle.longBreakMinutes === null || cycle.longBreakEvery === null) return null
    if (!within(cycle.longBreakMinutes, STUDY_CYCLE_LIMITS.longBreakMinutes)) return 'long_break_minutes'
    if (!within(cycle.longBreakEvery, STUDY_CYCLE_LIMITS.longBreakEvery)) return 'long_break_every'
    return null
}
