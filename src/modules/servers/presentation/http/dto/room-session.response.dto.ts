import { ApiProperty } from '@nestjs/swagger'
import { Expose } from 'class-transformer'
import { IsDate, IsIn, IsInt, IsOptional, IsString } from 'class-validator'

/**
 * A voice room's study session not yet ended (D-220), the same as
 * `focus_session.*` sends: the client counts down from phase_ends_at with
 * the offset of server_time (D-222).
 */
export class RoomSessionResponseDto {
    @Expose()
    @IsString()
    id: string

    /** Null: nobody in the room may start a session (REQ-STUDY-03). */
    @ApiProperty({ type: String, nullable: true })
    @Expose()
    @IsOptional()
    @IsString()
    hostId: string | null

    /** The cycle, in minutes. */
    @Expose()
    @IsInt()
    focusMinutes: number

    @Expose()
    @IsInt()
    shortBreakMinutes: number

    /** Both null: no long break. */
    @ApiProperty({ type: Number, nullable: true })
    @Expose()
    @IsOptional()
    @IsInt()
    longBreakMinutes: number | null

    @ApiProperty({ type: Number, nullable: true })
    @Expose()
    @IsOptional()
    @IsInt()
    longBreakEvery: number | null

    @Expose()
    @IsIn(['running', 'paused'])
    status: 'running' | 'paused'

    @Expose()
    @IsIn(['focus', 'short_break', 'long_break'])
    phase: 'focus' | 'short_break' | 'long_break'

    /** The phase's place from 0: focus at the even places. */
    @Expose()
    @IsInt()
    phaseIndex: number

    @Expose()
    @IsDate()
    phaseStartedAt: Date

    /** While running: when the phase ends. */
    @ApiProperty({ type: Date, nullable: true })
    @Expose()
    @IsOptional()
    @IsDate()
    phaseEndsAt: Date | null

    /** While paused: what was left of the phase, in milliseconds. */
    @ApiProperty({ type: Number, nullable: true })
    @Expose()
    @IsOptional()
    @IsInt()
    pausedRemainingMs: number | null

    /** When the focus stretch running now began: today's minutes go up from here (D-224). Null when none runs. */
    @ApiProperty({ type: Date, nullable: true })
    @Expose()
    @IsOptional()
    @IsDate()
    stretchStartedAt: Date | null

    @Expose()
    @IsDate()
    startedAt: Date

    /** Raised by every change; sent back with each command (D-225). */
    @Expose()
    @IsInt()
    version: number

    /** The server's clock when this was read (D-18). */
    @Expose()
    @IsDate()
    serverTime: Date
}
