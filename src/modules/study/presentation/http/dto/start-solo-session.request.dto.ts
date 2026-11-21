import { CycleMinutes } from './cycle.decorators'

/**
 * POST /me/solo-session (REQ-STUDY-05): the cycle to start with. Nothing
 * sent: the last Solo's, or 25/5 for a first one (D-103). focus_minutes and
 * short_break_minutes go together; the long break, both halves or neither.
 */
export class StartSoloSessionRequestDto {
    @CycleMinutes('focusMinutes', { optional: true, nullable: false })
    focusMinutes?: number

    @CycleMinutes('shortBreakMinutes', { optional: true, nullable: false })
    shortBreakMinutes?: number

    /** Null or left out, with long_break_every: no long break. */
    @CycleMinutes('longBreakMinutes', { optional: true, nullable: true })
    longBreakMinutes?: number | null

    /** A long break after every this many focus phases. */
    @CycleMinutes('longBreakEvery', { optional: true, nullable: true })
    longBreakEvery?: number | null
}
