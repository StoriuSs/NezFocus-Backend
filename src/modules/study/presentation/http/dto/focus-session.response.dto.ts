import { ApiProperty } from '@nestjs/swagger'
import { Expose } from 'class-transformer'
import { IsDate, IsIn, IsInt, IsOptional, IsString } from 'class-validator'

/**
 * A study session (SRS 5.1, D-220, D-222), the same as `focus_session.*`
 * sends: the client counts down from phase_ends_at with the offset of
 * server_time, never from its own clock alone (D-18).
 */
export class FocusSessionResponseDto {
    @Expose()
    @IsString()
    id: string

    @Expose()
    @IsIn(['room', 'solo'])
    kind: 'room' | 'solo'

    /** A Room Session's room; null for a Solo. */
    @ApiProperty({ type: String, nullable: true })
    @Expose()
    @IsOptional()
    @IsString()
    channelId: string | null

    /** Null: no Host (nobody in the room may start a session, REQ-STUDY-03), or a Solo. */
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
    @IsIn(['running', 'paused', 'waiting', 'ended'])
    status: 'running' | 'paused' | 'waiting' | 'ended'

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

    /** While waiting (a Solo): when it ends by itself. */
    @ApiProperty({ type: Date, nullable: true })
    @Expose()
    @IsOptional()
    @IsDate()
    waitingUntil: Date | null

    /** When the focus stretch running now began: today's minutes go up from here (D-224). Null when none runs. */
    @ApiProperty({ type: Date, nullable: true })
    @Expose()
    @IsOptional()
    @IsDate()
    stretchStartedAt: Date | null

    @Expose()
    @IsDate()
    startedAt: Date

    @ApiProperty({ type: Date, nullable: true })
    @Expose()
    @IsOptional()
    @IsDate()
    endedAt: Date | null

    @ApiProperty({
        type: String,
        nullable: true,
        enum: ['stopped', 'empty', 'study_disabled', 'channel_deleted', 'expired', 'signed_out', 'joined_room']
    })
    @Expose()
    @IsOptional()
    @IsString()
    endedReason: string | null

    /** Raised by every change; sent back with each command (D-225). */
    @Expose()
    @IsInt()
    version: number

    /** The server's clock when this was read (D-18). */
    @Expose()
    @IsDate()
    serverTime: Date
}
