import { ApiPropertyOptional } from '@nestjs/swagger'
import {
    ArrayMaxSize,
    IsArray,
    IsBoolean,
    IsIn,
    IsInt,
    IsString,
    IsUUID,
    Max,
    MaxLength,
    Min,
    ValidateIf
} from 'class-validator'
import { CHANNEL_NAME_MAX_LENGTH, STUDY_CYCLE_LIMITS } from '../../../domain'
import { MAX_VIEW_ROLES, sent, TYPED_MAX } from './shared/fields'

/*
 * Bodies of the channel list routes (REQ-SRV-02). Names are only bounded
 * here: what they are stored as, and whether that is allowed, depends on the
 * kind of channel and is decided in domain/channel-layout.ts
 * (VALIDATION_ERROR with `data.rule`).
 */

const { focusMinutes, shortBreakMinutes, longBreakMinutes, longBreakEvery } = STUDY_CYCLE_LIMITS

/**
 * PATCH /servers/{id}/channels/{cid} (S-SET-05, S-SET-06): only what is sent
 * changes. Someone with MANAGE_STUDY_ROOMS but not MANAGE_CHANNELS may change
 * a room's study settings only (D-210).
 */
export class UpdateChannelRequestDto {
    @ApiPropertyOptional({ maxLength: CHANNEL_NAME_MAX_LENGTH })
    @ValidateIf(sent)
    @IsString()
    @MaxLength(TYPED_MAX)
    name?: string

    /** Text channels: `managers` lets only MANAGE_MESSAGES post. */
    @ApiPropertyOptional({ enum: ['everyone', 'managers'] })
    @ValidateIf(sent)
    @IsIn(['everyone', 'managers'])
    sendMode?: 'everyone' | 'managers'

    /** Public again: its view roles are cleared. */
    @ApiPropertyOptional()
    @ValidateIf(sent)
    @IsBoolean()
    isPrivate?: boolean

    /** Replaces the whole set. */
    @ApiPropertyOptional({ type: [String], format: 'uuid' })
    @ValidateIf(sent)
    @IsArray()
    @ArrayMaxSize(MAX_VIEW_ROLES)
    @IsUUID(undefined, { each: true })
    viewRoleIds?: string[]

    /** Text channels: off hides its tasks and stops their reminders; on shows them again (REQ-TASK-01). */
    @ApiPropertyOptional()
    @ValidateIf(sent)
    @IsBoolean()
    taskBoardEnabled?: boolean

    /** Rooms: a shared Pomodoro (REQ-STUDY-01). Off keeps the settings below for when it is on again. */
    @ApiPropertyOptional()
    @ValidateIf(sent)
    @IsBoolean()
    isStudyRoom?: boolean

    /** Rooms: who may start a session, anyone in the room or only MANAGE_STUDY_ROOMS. */
    @ApiPropertyOptional({ enum: ['anyone', 'managers'] })
    @ValidateIf(sent)
    @IsIn(['anyone', 'managers'])
    studyStarter?: 'anyone' | 'managers'

    /** Rooms: the cycle a new session starts with. */
    @ApiPropertyOptional({ minimum: focusMinutes.min, maximum: focusMinutes.max })
    @ValidateIf(sent)
    @IsInt()
    @Min(focusMinutes.min)
    @Max(focusMinutes.max)
    studyFocusMinutes?: number

    @ApiPropertyOptional({ minimum: shortBreakMinutes.min, maximum: shortBreakMinutes.max })
    @ValidateIf(sent)
    @IsInt()
    @Min(shortBreakMinutes.min)
    @Max(shortBreakMinutes.max)
    studyShortBreakMinutes?: number

    /** Null, with `study_long_break_every` null: no long break. One without the other is refused (`study_cycle`). */
    @ApiPropertyOptional({ type: Number, nullable: true, minimum: longBreakMinutes.min, maximum: longBreakMinutes.max })
    @ValidateIf((_, value) => value !== undefined && value !== null)
    @IsInt()
    @Min(longBreakMinutes.min)
    @Max(longBreakMinutes.max)
    studyLongBreakMinutes?: number | null

    /** A long break after every this many focus phases. */
    @ApiPropertyOptional({ type: Number, nullable: true, minimum: longBreakEvery.min, maximum: longBreakEvery.max })
    @ValidateIf((_, value) => value !== undefined && value !== null)
    @IsInt()
    @Min(longBreakEvery.min)
    @Max(longBreakEvery.max)
    studyLongBreakEvery?: number | null
}
