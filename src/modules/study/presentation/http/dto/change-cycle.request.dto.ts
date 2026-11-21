import { IsInt, Min } from 'class-validator'
import { CycleMinutes } from './cycle.decorators'

/**
 * POST /focus-sessions/{id}/config (REQ-STUDY-03, D-50): a new cycle, only
 * while paused (else VALIDATION_ERROR `not_paused`), and the version the
 * client saw (D-225).
 */
export class ChangeCycleRequestDto {
    @IsInt()
    @Min(0)
    version: number

    @CycleMinutes('focusMinutes', { optional: false, nullable: false })
    focusMinutes: number

    @CycleMinutes('shortBreakMinutes', { optional: false, nullable: false })
    shortBreakMinutes: number

    /** Null or left out, with long_break_every: no long break. */
    @CycleMinutes('longBreakMinutes', { optional: true, nullable: true })
    longBreakMinutes?: number | null

    @CycleMinutes('longBreakEvery', { optional: true, nullable: true })
    longBreakEvery?: number | null
}
